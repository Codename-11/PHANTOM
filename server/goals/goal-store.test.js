import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { initDB, closeDB, createConversation, createRun, updateRunStatus, setSetting } from '../memory/store.js';
import {
  createGoal, getGoal, getGoals, updateGoal, deleteGoal,
  activateGoal, getCurrentGoal, getCurrentGoalId, clearCurrentGoal,
  completeGoal,
  logProgress, getProgress,
  recordSatisfactionClaim,
  tagRunWithGoal, getLinkedRuns, countLinkedRuns,
} from './goal-store.js';

describe('goal store', () => {
  afterEach(() => closeDB());

  test('creates, fetches, updates, and deletes goals', () => {
    initDB(':memory:');
    const goal = createGoal({
      title: 'Map AdminPortal exposure',
      objective: 'Identify any internet-exposed admin interfaces in the AdminPortal subnet.',
      successCriteria: 'Each host in the subnet has a finding entry (open or fixed).',
    });
    assert.ok(goal.id);
    assert.strictEqual(goal.status, 'active');
    assert.ok(!JSON.stringify(goal).includes('success_criteria_json'));

    const fetched = getGoal(goal.id);
    assert.strictEqual(fetched.title, goal.title);

    const updated = updateGoal(goal.id, { title: 'Map AdminPortal exposure (v2)' });
    assert.strictEqual(updated.title, 'Map AdminPortal exposure (v2)');

    assert.ok(getGoals().some((g) => g.id === goal.id));

    assert.strictEqual(deleteGoal(goal.id), true);
    assert.strictEqual(getGoal(goal.id), null);
  });

  test('rejects empty title/objective/successCriteria', () => {
    initDB(':memory:');
    assert.throws(() => createGoal({ title: '', objective: 'x', successCriteria: 'y' }), /title is required/);
    assert.throws(() => createGoal({ title: 'x', objective: '   ', successCriteria: 'y' }), /objective is required/);
    assert.throws(() => createGoal({ title: 'x', objective: 'y', successCriteria: '' }), /successCriteria is required/);
  });

  test('activate / current / clear flow', () => {
    initDB(':memory:');
    const a = createGoal({ title: 'A', objective: 'A', successCriteria: 'A' });
    const b = createGoal({ title: 'B', objective: 'B', successCriteria: 'B' });

    assert.strictEqual(getCurrentGoal(), null);

    activateGoal(a.id);
    assert.strictEqual(getCurrentGoalId(), a.id);
    assert.strictEqual(getCurrentGoal().id, a.id);

    // activating a different goal overwrites — single-active invariant
    activateGoal(b.id);
    assert.strictEqual(getCurrentGoalId(), b.id);

    clearCurrentGoal();
    assert.strictEqual(getCurrentGoal(), null);
  });

  test('current-goal pointer self-heals when row is deleted', () => {
    initDB(':memory:');
    const g = createGoal({ title: 'X', objective: 'X', successCriteria: 'X' });
    activateGoal(g.id);
    deleteGoal(g.id);
    assert.strictEqual(getCurrentGoal(), null);
    assert.strictEqual(getCurrentGoalId(), null);
  });

  test('logs progress with trimming and kind validation', () => {
    initDB(':memory:');
    const g = createGoal({ title: 't', objective: 'o', successCriteria: 's' });
    const note = 'a'.repeat(400);
    const p = logProgress({ goalId: g.id, note, kind: 'unknown-kind' });
    assert.ok(p.note.length <= 280);
    assert.strictEqual(p.kind, 'step'); // unknown kinds fall back to 'step'
    assert.ok(p.note.endsWith('…'));

    const list = getProgress(g.id);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, p.id);
  });

  test('progress rate-cap blocks beyond goal_progress_daily_cap', () => {
    initDB(':memory:');
    setSetting('goal_progress_daily_cap', '3');
    const g = createGoal({ title: 't', objective: 'o', successCriteria: 's' });
    logProgress({ goalId: g.id, note: 'one' });
    logProgress({ goalId: g.id, note: 'two' });
    logProgress({ goalId: g.id, note: 'three' });
    assert.throws(() => logProgress({ goalId: g.id, note: 'four' }), /cap reached/);
  });

  test('recordSatisfactionClaim is idempotent — last claim wins', () => {
    initDB(':memory:');
    const g = createGoal({ title: 't', objective: 'o', successCriteria: 's' });

    const first = recordSatisfactionClaim(g.id, { justification: 'first', confidence: 'low' });
    assert.ok(first.satisfied_at);
    assert.strictEqual(first.satisfaction_claim.justification, 'first');

    const second = recordSatisfactionClaim(g.id, { justification: 'second', confidence: 'high' });
    assert.strictEqual(second.satisfaction_claim.justification, 'second');
    assert.strictEqual(second.satisfaction_claim.confidence, 'high');

    // status stays 'active' — only the operator can flip to completed
    assert.strictEqual(second.status, 'active');
  });

  test('completeGoal flips status + clears active pointer when matching', () => {
    initDB(':memory:');
    const g = createGoal({ title: 't', objective: 'o', successCriteria: 's' });
    activateGoal(g.id);
    const closed = completeGoal(g.id, { note: 'operator confirmed' });
    assert.strictEqual(closed.status, 'completed');
    assert.ok(closed.completed_at);
    assert.strictEqual(getCurrentGoal(), null);

    const progress = getProgress(g.id);
    assert.ok(progress.some((p) => p.note === 'operator confirmed'));
  });

  test('runs can be tagged with goal_id and counted', () => {
    initDB(':memory:');
    const g = createGoal({ title: 't', objective: 'o', successCriteria: 's' });
    const conv = createConversation('c');
    const r1 = createRun({ conversationId: conv.id, title: 'r1', goal: 'one', model: 'm', providerRoute: 'p' });
    const r2 = createRun({ conversationId: conv.id, title: 'r2', goal: 'two', model: 'm', providerRoute: 'p' });
    tagRunWithGoal(r1.id, g.id);
    tagRunWithGoal(r2.id, g.id);

    // r1 finishes, r2 is still running → countLinkedRuns terminalOnly=true is 1
    updateRunStatus(r1.id, 'completed', { summary: 'ok' });

    assert.strictEqual(countLinkedRuns(g.id, { terminalOnly: true }), 1);
    assert.strictEqual(countLinkedRuns(g.id, { terminalOnly: false }), 2);

    const linked = getLinkedRuns(g.id);
    assert.strictEqual(linked.length, 2);
  });

  test('deleting a goal nulls runs.goal_id (preserves the runs)', () => {
    initDB(':memory:');
    const g = createGoal({ title: 't', objective: 'o', successCriteria: 's' });
    const conv = createConversation('c');
    const run = createRun({ conversationId: conv.id, title: 'r', goal: 'g', model: 'm', providerRoute: 'p' });
    tagRunWithGoal(run.id, g.id);
    assert.strictEqual(countLinkedRuns(g.id, { terminalOnly: false }), 1);

    deleteGoal(g.id);
    // The run row itself survives; only goal_id is nulled.
    assert.strictEqual(countLinkedRuns(g.id, { terminalOnly: false }), 0);
  });
});
