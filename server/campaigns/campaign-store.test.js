import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDB, closeDB, createConversation, createRun,
} from '../memory/store.js';
import {
  createCampaign, getCampaign, listCampaigns, updateCampaign, updateCampaignStatus, deleteCampaign,
  createCampaignGoal, getCampaignGoal, listCampaignGoals, updateCampaignGoalStatus,
  recordEvaluatorResult, bumpAttemptCount,
  linkGoalRun, updateGoalRunStatus, listGoalRuns, listCampaignRuns, countCampaignRuns,
  findGoalForRun,
} from './campaign-store.js';

describe('campaign store', () => {
  afterEach(() => closeDB());

  test('createCampaign requires title and objective; defaults backend + budgets', () => {
    initDB(':memory:');
    assert.throws(() => createCampaign({ title: '', objective: 'x' }), /title is required/);
    assert.throws(() => createCampaign({ title: 'x', objective: '' }), /objective is required/);

    const c = createCampaign({ title: 'C1', objective: 'demonstrate the engine' });
    assert.ok(c.id);
    assert.strictEqual(c.status, 'draft');
    assert.strictEqual(c.worker_backend, 'phantom-native');
    assert.ok(c.run_budget.maxChildRuns >= 1);
    assert.ok(Array.isArray(c.risk_budget.allowedRiskClasses));
    assert.deepStrictEqual(c.toolpack_ids, []);
  });

  test('createCampaign rejects unknown worker_backend', () => {
    initDB(':memory:');
    assert.throws(
      () => createCampaign({ title: 'C', objective: 'O', workerBackend: 'not-a-thing' }),
      /unknown worker_backend/
    );
  });

  test('listCampaigns + status filter', () => {
    initDB(':memory:');
    const a = createCampaign({ title: 'A', objective: 'a' });
    const b = createCampaign({ title: 'B', objective: 'b' });
    updateCampaignStatus(b.id, 'running', { stampStart: true });
    assert.strictEqual(listCampaigns().length, 2);
    assert.strictEqual(listCampaigns({ status: 'draft' }).length, 1);
    assert.strictEqual(listCampaigns({ status: 'running' })[0].id, b.id);
  });

  test('updateCampaign merges fields and validates backend', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    const updated = updateCampaign(c.id, {
      title: 'C renamed',
      toolpackIds: ['web-recon'],
      runBudget: { maxChildRuns: 5 },
    });
    assert.strictEqual(updated.title, 'C renamed');
    assert.deepStrictEqual(updated.toolpack_ids, ['web-recon']);
    assert.strictEqual(updated.run_budget.maxChildRuns, 5);
    // Defaults still merge in for unset keys
    assert.ok(updated.run_budget.maxWallClockMinutes);

    assert.throws(() => updateCampaign(c.id, { workerBackend: 'nope' }), /unknown worker_backend/);
  });

  test('updateCampaignStatus stamps started_at once and ended_at on terminal', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    let s = updateCampaignStatus(c.id, 'running', { stampStart: true });
    const firstStart = s.started_at;
    assert.ok(firstStart);

    s = updateCampaignStatus(c.id, 'paused');
    s = updateCampaignStatus(c.id, 'running', { stampStart: true });
    assert.strictEqual(s.started_at, firstStart, 'started_at is sticky across pause/resume');

    s = updateCampaignStatus(c.id, 'completed', { stampEnd: true });
    assert.ok(s.ended_at);
  });

  test('createCampaignGoal requires fields and inherits maxAttempts from budget', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O', runBudget: { maxAttemptsPerGoal: 5 } });
    const g = createCampaignGoal({ campaignId: c.id, title: 'g1', prompt: 'do thing' });
    assert.strictEqual(g.status, 'queued');
    assert.strictEqual(g.max_attempts, 5);
    assert.strictEqual(g.attempt_count, 0);

    assert.throws(
      () => createCampaignGoal({ campaignId: 'missing', title: 't', prompt: 'p' }),
      /campaign not found/
    );
    assert.throws(
      () => createCampaignGoal({ campaignId: c.id, title: '', prompt: 'p' }),
      /title is required/
    );
  });

  test('parent_goal_id supports tree decomposition', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    const root = createCampaignGoal({ campaignId: c.id, title: 'root', prompt: 'p' });
    const child = createCampaignGoal({
      campaignId: c.id, title: 'child', prompt: 'p', parentGoalId: root.id,
    });
    assert.strictEqual(child.parent_goal_id, root.id);
    const all = listCampaignGoals(c.id);
    assert.strictEqual(all.length, 2);
  });

  test('updateCampaignGoalStatus + recordEvaluatorResult + bumpAttemptCount', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    const g = createCampaignGoal({ campaignId: c.id, title: 't', prompt: 'p' });

    let s = updateCampaignGoalStatus(g.id, 'running', { stampStart: true });
    assert.strictEqual(s.status, 'running');
    assert.ok(s.started_at);

    s = bumpAttemptCount(g.id);
    s = bumpAttemptCount(g.id);
    assert.strictEqual(s.attempt_count, 2);

    const evalOut = { decision: 'complete', confidence: 0.9, summary: 'ok' };
    s = recordEvaluatorResult(g.id, evalOut);
    assert.deepStrictEqual(s.evaluator_result, evalOut);

    s = updateCampaignGoalStatus(g.id, 'completed', { stampEnd: true });
    assert.ok(s.ended_at);
  });

  test('linkGoalRun + listGoalRuns + countCampaignRuns + findGoalForRun', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    const g = createCampaignGoal({ campaignId: c.id, title: 't', prompt: 'p' });

    const conv = createConversation('conv');
    const run = createRun({
      conversationId: conv.id, title: 'r', goal: 'g', model: 'm', providerRoute: 'p',
    });
    const link = linkGoalRun({ campaignId: c.id, goalId: g.id, runId: run.id });
    assert.strictEqual(link.status, 'spawned');

    const list = listGoalRuns(g.id);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(countCampaignRuns(c.id), 1);

    const updated = updateGoalRunStatus(link.id, 'completed');
    assert.strictEqual(updated.status, 'completed');

    const reverse = findGoalForRun(run.id);
    assert.ok(reverse);
    assert.strictEqual(reverse.campaign.id, c.id);
    assert.strictEqual(reverse.goal.id, g.id);
  });

  test('deleteCampaign cascades to goals and run links', () => {
    initDB(':memory:');
    const c = createCampaign({ title: 'C', objective: 'O' });
    const g = createCampaignGoal({ campaignId: c.id, title: 't', prompt: 'p' });
    const conv = createConversation('conv');
    const run = createRun({ conversationId: conv.id, title: 'r', goal: 'g', model: 'm', providerRoute: 'p' });
    linkGoalRun({ campaignId: c.id, goalId: g.id, runId: run.id });

    assert.strictEqual(deleteCampaign(c.id), true);
    assert.strictEqual(getCampaign(c.id), null);
    assert.strictEqual(getCampaignGoal(g.id), null);
    assert.strictEqual(listCampaignRuns(c.id).length, 0);
  });
});
