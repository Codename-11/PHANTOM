import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDB, closeDB,
  addTraceEvent, completeRun, failRun,
} from '../memory/store.js';
import { createScope } from '../scope/scope-store.js';
import {
  createCampaign, updateCampaignStatus,
  createCampaignGoal, getCampaignGoal,
  listGoalRuns, countCampaignRuns,
  getCampaign,
} from './campaign-store.js';
import { runOneGoal, finalizeRunForCampaign, nextQueuedGoal } from './goal-engine.js';

describe('goal engine — spawn + finalize loop', () => {
  afterEach(() => closeDB());

  test('runOneGoal: phantom-native backend creates a run + link, transitions goal to running, emits trace', () => {
    initDB(':memory:');
    const scope = createScope({ name: 's', targets: { hosts: ['localhost'] } });
    const campaign = createCampaign({
      title: 'C', objective: 'O', scopeId: scope.id,
    });
    updateCampaignStatus(campaign.id, 'running', { stampStart: true });
    const goal = createCampaignGoal({ campaignId: campaign.id, title: 'g1', prompt: 'do a thing' });

    const { run, link, conversationId } = runOneGoal({ campaignId: campaign.id, goalId: goal.id });
    assert.ok(run.id);
    assert.ok(conversationId);
    assert.strictEqual(link.worker_backend, 'phantom-native');

    const refetched = getCampaignGoal(goal.id);
    assert.strictEqual(refetched.status, 'running');
    assert.strictEqual(refetched.attempt_count, 1);

    assert.strictEqual(listGoalRuns(goal.id).length, 1);
    assert.strictEqual(countCampaignRuns(campaign.id), 1);
  });

  test('runOneGoal refuses when campaign is paused/canceled', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    const g = createCampaignGoal({ campaignId: c.id, title: 'g', prompt: 'p' });
    updateCampaignStatus(c.id, 'paused');
    assert.throws(() => runOneGoal({ campaignId: c.id, goalId: g.id }), /cannot spawn/);
  });

  test('runOneGoal refuses when goal is not queued/blocked', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    const g = createCampaignGoal({ campaignId: c.id, title: 'g', prompt: 'p' });
    updateCampaignStatus(c.id, 'running', { stampStart: true });
    // Spawn once → goal becomes 'running' → second spawn rejected
    runOneGoal({ campaignId: c.id, goalId: g.id });
    assert.throws(() => runOneGoal({ campaignId: c.id, goalId: g.id }), /only queued or blocked/);
  });

  test('runOneGoal refuses when maxChildRuns is reached', () => {
    initDB(':memory:');
    const c = createCampaign({
      title: 'C', objective: 'O',
      runBudget: { maxChildRuns: 1 },
    });
    updateCampaignStatus(c.id, 'running', { stampStart: true });
    const g1 = createCampaignGoal({ campaignId: c.id, title: 'g1', prompt: 'p' });
    const g2 = createCampaignGoal({ campaignId: c.id, title: 'g2', prompt: 'p' });
    runOneGoal({ campaignId: c.id, goalId: g1.id });
    assert.throws(() => runOneGoal({ campaignId: c.id, goalId: g2.id }), /maxChildRuns/);
  });

  test('finalizeRunForCampaign: completed run with finding → goal status pause + campaign paused', async () => {
    initDB(':memory:');
    const c = createCampaign({
      title: 'C', objective: 'O',
      riskBudget: { pauseOnNewFinding: true },
    });
    updateCampaignStatus(c.id, 'running', { stampStart: true });
    const goal = createCampaignGoal({ campaignId: c.id, title: 'g', prompt: 'p' });
    const { run } = runOneGoal({ campaignId: c.id, goalId: goal.id });

    // Mimic a finding being filed against the run by inserting directly
    // into the findings table — testing the finalize path, not the
    // finding-creation API.
    const { getDB } = await import('../memory/store.js');
    const { v4: uuid } = await import('uuid');
    getDB().prepare(
      `INSERT INTO findings (id, run_id, title, severity, status)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uuid(), run.id, 'open admin login', 'high', 'open');

    completeRun(run.id, 'done');
    const result = finalizeRunForCampaign(run.id);
    assert.ok(result, 'finalize returned a verdict');
    assert.strictEqual(result.verdict.decision, 'pause');
    assert.strictEqual(getCampaignGoal(goal.id).status, 'blocked');
    assert.strictEqual(getCampaign(c.id).status, 'paused');
  });

  test('finalizeRunForCampaign: failed run with attempts left → goal re-queued', () => {
    initDB(':memory:');
    const c = createCampaign({
      title: 'C', objective: 'O',
      runBudget: { maxAttemptsPerGoal: 3 },
    });
    updateCampaignStatus(c.id, 'running', { stampStart: true });
    const goal = createCampaignGoal({ campaignId: c.id, title: 'g', prompt: 'p' });
    const { run } = runOneGoal({ campaignId: c.id, goalId: goal.id });

    addTraceEvent(run.id, {
      type: 'tool.call.failed', phase: 'tool', status: 'failed',
      tool_name: 'execute_command', outputPreview: 'segfault',
    });
    failRun(run.id, 'failed');

    const result = finalizeRunForCampaign(run.id);
    assert.strictEqual(result.verdict.decision, 'retry');
    assert.strictEqual(getCampaignGoal(goal.id).status, 'queued', 'retried goal goes back to queued');
  });

  test('finalizeRunForCampaign: blocked tool call → goal needs_approval + campaign needs_approval', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    updateCampaignStatus(c.id, 'running', { stampStart: true });
    const goal = createCampaignGoal({ campaignId: c.id, title: 'g', prompt: 'p' });
    const { run } = runOneGoal({ campaignId: c.id, goalId: goal.id });

    addTraceEvent(run.id, {
      type: 'tool.call.blocked', phase: 'tool', status: 'blocked',
      tool_name: 'execute_command',
      metadata: { risk: 'exploit', reason: 'out of scope', target: 'evil.example.com' },
    });
    completeRun(run.id, 'done');

    const result = finalizeRunForCampaign(run.id);
    assert.strictEqual(result.verdict.decision, 'needs_approval');
    assert.strictEqual(getCampaignGoal(goal.id).status, 'needs_approval');
    assert.strictEqual(getCampaign(c.id).status, 'needs_approval');
  });

  test('finalizeRunForCampaign: untagged run is a no-op', async () => {
    initDB(':memory:');
    const { createConversation, createRun } = await import('../memory/store.js');
    const conv = createConversation('c');
    const run = createRun({ conversationId: conv.id, title: 'r', goal: 'x', model: 'm', providerRoute: 'p' });
    completeRun(run.id, 'done');
    const result = finalizeRunForCampaign(run.id);
    assert.strictEqual(result, null);
  });

  test('nextQueuedGoal returns highest priority oldest first; null when drained', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    assert.strictEqual(nextQueuedGoal(c.id), null);

    const g1 = createCampaignGoal({ campaignId: c.id, title: 'g1', prompt: 'p', priority: 0 });
    const g2 = createCampaignGoal({ campaignId: c.id, title: 'g2', prompt: 'p', priority: 10 });
    assert.strictEqual(nextQueuedGoal(c.id).id, g2.id, 'higher priority wins');
  });
});
