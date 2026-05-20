import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB, createConversation, createRun } from '../memory/store.js';
import {
  getPhantomToolDefinitions, isPhantomTool, executePhantomTool,
} from './phantom-tools.js';
import {
  createGoal, activateGoal, getGoal, getProgress,
} from '../goals/goal-store.js';

describe('phantom tools — goal dispatch', () => {
  afterEach(() => closeDB());

  test('goal tools are registered in the tool registry', () => {
    const names = getPhantomToolDefinitions().map((t) => t.function.name);
    assert.ok(names.includes('phantom_get_goal'), 'phantom_get_goal registered');
    assert.ok(names.includes('phantom_log_goal_progress'), 'phantom_log_goal_progress registered');
    assert.ok(names.includes('phantom_declare_goal_satisfied'), 'phantom_declare_goal_satisfied registered');
    assert.ok(isPhantomTool('phantom_get_goal'));
    assert.ok(isPhantomTool('phantom_log_goal_progress'));
    assert.ok(isPhantomTool('phantom_declare_goal_satisfied'));
  });

  test('phantom_get_goal returns "No active goal." when none is set', async () => {
    initDB(':memory:');
    const out = await executePhantomTool('phantom_get_goal', {}, {});
    assert.strictEqual(out, 'No active goal.');
  });

  test('phantom_get_goal returns full goal + progress when active', async () => {
    initDB(':memory:');
    const g = createGoal({ title: 'T', objective: 'O', successCriteria: 'S' });
    activateGoal(g.id);

    const out = await executePhantomTool('phantom_get_goal', {}, {});
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.goal.id, g.id);
    assert.ok(Array.isArray(parsed.recent_progress));
    assert.ok(Array.isArray(parsed.recent_runs));
  });

  test('phantom_log_goal_progress requires note and active goal', async () => {
    initDB(':memory:');
    // No active goal — should refuse
    let out = await executePhantomTool('phantom_log_goal_progress', { note: 'x' }, {});
    assert.strictEqual(out, 'No active goal.');

    const g = createGoal({ title: 'T', objective: 'O', successCriteria: 'S' });
    activateGoal(g.id);

    // Empty note — should refuse
    out = await executePhantomTool('phantom_log_goal_progress', { note: '   ' }, {});
    assert.strictEqual(out, 'note is required');

    // Happy path — runId points at a real run (FK requires it)
    const conv = createConversation('c');
    const run = createRun({ conversationId: conv.id, title: 'r', goal: 'g', model: 'm', providerRoute: 'p' });
    out = await executePhantomTool('phantom_log_goal_progress', { note: 'first step', kind: 'step' }, { runId: run.id });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.logged, true);
    assert.strictEqual(parsed.progress.note, 'first step');
    assert.strictEqual(parsed.progress.run_id, run.id);

    const persisted = getProgress(g.id);
    assert.strictEqual(persisted.length, 1);
  });

  test('phantom_declare_goal_satisfied records claim but does NOT change status', async () => {
    initDB(':memory:');
    const g = createGoal({ title: 'T', objective: 'O', successCriteria: 'S' });
    activateGoal(g.id);

    const out = await executePhantomTool(
      'phantom_declare_goal_satisfied',
      { justification: 'all hosts have findings', confidence: 'high' },
      { runId: 'run-77' }
    );
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.claimed, true);
    assert.strictEqual(parsed.goal.status, 'active', 'agent claim does not auto-complete');
    assert.ok(parsed.goal.satisfied_at);
    assert.strictEqual(parsed.goal.satisfaction_claim.confidence, 'high');

    // The note explains the operator-confirmation requirement
    assert.match(parsed.note, /Operator must confirm/);

    // Underlying row matches
    const stored = getGoal(g.id);
    assert.strictEqual(stored.status, 'active');
    assert.strictEqual(stored.satisfaction_claim.justification, 'all hosts have findings');
  });

  test('phantom_declare_goal_satisfied refuses without justification', async () => {
    initDB(':memory:');
    const g = createGoal({ title: 'T', objective: 'O', successCriteria: 'S' });
    activateGoal(g.id);
    const out = await executePhantomTool('phantom_declare_goal_satisfied', {}, {});
    assert.strictEqual(out, 'justification is required');
  });
});
