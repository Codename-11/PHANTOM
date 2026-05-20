import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDB, closeDB,
  createConversation, createRun, addTraceEvent, completeRun, failRun, updateRunStatus,
} from '../memory/store.js';
import {
  createGoal, activateGoal, getProgress, tagRunWithGoal,
} from './goal-store.js';
import {
  scoreRunAgainstGoal, recordRunOutcomeAgainstGoal,
} from './goal-progress.js';

describe('goal progress — heuristic + run-outcome hook', () => {
  afterEach(() => closeDB());

  test('scoreRunAgainstGoal: completed run + strong posture pushes score high', () => {
    const run = { status: 'completed' };
    const synthesis = {
      posture: { rating: 'strong' },
      findings: { total: 2 },
      activity: { toolCalls: { total: 10, succeeded: 10, failed: 0, blocked: 0 }, errors: 0 },
    };
    const { score, signals } = scoreRunAgainstGoal(run, synthesis);
    // 30 (completed) + 25 (strong) + 10 (findings) + 20 (10/10 calls) = 85
    assert.strictEqual(score, 85);
    assert.ok(signals.includes('run completed'));
    assert.ok(signals.includes('posture strong'));
  });

  test('scoreRunAgainstGoal: failed run with errors clamps to a low score', () => {
    const run = { status: 'failed' };
    const synthesis = {
      posture: { rating: 'weak' },
      findings: { total: 0 },
      activity: { toolCalls: { total: 5, succeeded: 1, failed: 4, blocked: 0 }, errors: 3 },
    };
    const { score } = scoreRunAgainstGoal(run, synthesis);
    // 0 (failed) + 5 (weak) + 0 (no findings) + 4 (1/5 calls = ratio*20=4) - 10 (errors) = -1 → 0
    assert.strictEqual(score, 0);
  });

  test('scoreRunAgainstGoal: stopped run + fair posture lands mid-range', () => {
    const run = { status: 'stopped' };
    const synthesis = {
      posture: { rating: 'fair' },
      findings: { total: 1 },
      activity: { toolCalls: { total: 4, succeeded: 2, failed: 0, blocked: 2 }, errors: 0 },
    };
    const { score } = scoreRunAgainstGoal(run, synthesis);
    // 10 (stopped) + 15 (fair) + 10 (findings) + 10 (2/4 calls) = 45
    assert.strictEqual(score, 45);
  });

  test('recordRunOutcomeAgainstGoal: tagged completed run yields an auto progress entry', () => {
    initDB(':memory:');
    const goal = createGoal({ title: 'Goal', objective: 'O', successCriteria: 'S' });
    activateGoal(goal.id);

    const conv = createConversation('c');
    const run = createRun({ conversationId: conv.id, title: 'Recon', goal: 'first pass', model: 'm', providerRoute: 'p' });
    tagRunWithGoal(run.id, goal.id);

    // Minimal trace so synthesis has something to work with
    addTraceEvent(run.id, { type: 'run.started', phase: 'general', status: 'started', outputPreview: 'start' });
    completeRun(run.id, 'all done');

    const entry = recordRunOutcomeAgainstGoal(run.id);
    assert.ok(entry, 'progress entry returned');
    assert.strictEqual(entry.kind, 'auto');
    assert.strictEqual(entry.run_id, run.id);
    assert.match(entry.note, /completed/);
    assert.match(entry.note, /score \d+/);

    const all = getProgress(goal.id);
    assert.strictEqual(all.length, 1);
  });

  test('recordRunOutcomeAgainstGoal: untagged run is a silent no-op', () => {
    initDB(':memory:');
    const goal = createGoal({ title: 'Goal', objective: 'O', successCriteria: 'S' });
    activateGoal(goal.id);

    const conv = createConversation('c');
    const run = createRun({ conversationId: conv.id, title: 'Untagged', goal: 'x', model: 'm', providerRoute: 'p' });
    completeRun(run.id, 'done');

    // No tagRunWithGoal call — run has no goal_id
    const entry = recordRunOutcomeAgainstGoal(run.id);
    assert.strictEqual(entry, null);
    assert.strictEqual(getProgress(goal.id).length, 0);
  });

  test('recordRunOutcomeAgainstGoal: failed run still appends auto-progress', () => {
    initDB(':memory:');
    const goal = createGoal({ title: 'Goal', objective: 'O', successCriteria: 'S' });
    activateGoal(goal.id);

    const conv = createConversation('c');
    const run = createRun({ conversationId: conv.id, title: 'Crashed', goal: 'x', model: 'm', providerRoute: 'p' });
    tagRunWithGoal(run.id, goal.id);
    failRun(run.id, 'tool blew up');

    const entry = recordRunOutcomeAgainstGoal(run.id);
    assert.ok(entry);
    assert.match(entry.note, /failed/);
  });

  test('recordRunOutcomeAgainstGoal: stopped run is also captured', () => {
    initDB(':memory:');
    const goal = createGoal({ title: 'Goal', objective: 'O', successCriteria: 'S' });
    activateGoal(goal.id);

    const conv = createConversation('c');
    const run = createRun({ conversationId: conv.id, title: 'Stopped', goal: 'x', model: 'm', providerRoute: 'p' });
    tagRunWithGoal(run.id, goal.id);
    updateRunStatus(run.id, 'stopped', { summary: 'user stopped' });

    const entry = recordRunOutcomeAgainstGoal(run.id);
    assert.ok(entry);
    assert.match(entry.note, /stopped/);
  });
});
