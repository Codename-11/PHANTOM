import { describe, test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { initDB, closeDB, getRun, getTraceEvents, getArtifactsForRun } from '../../memory/store.js';
import { createCampaign, createCampaignGoal } from '../campaign-store.js';
import { spawnGoalRun, _resetAvailabilityCache, BACKEND_ID } from './codex-exec.js';

// Stubbed child process that lets the test deterministically drive
// stdout/stderr/exit-code events.
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function seedCampaignGoal() {
  initDB(':memory:');
  const c = createCampaign({
    title: 'Codex Lab', objective: 'Run a bounded codex worker.',
    workerBackend: 'codex-exec',
    notificationPolicy: { workdir: process.cwd() },
  });
  const g = createCampaignGoal({
    campaignId: c.id, title: 'List files', prompt: 'ls -la',
  });
  return { campaign: c, goal: g };
}

describe('codex-exec worker backend', () => {
  afterEach(() => { closeDB(); _resetAvailabilityCache(); });

  test('BACKEND_ID is "codex-exec"', () => {
    assert.strictEqual(BACKEND_ID, 'codex-exec');
  });

  test('spawnGoalRun creates run + linkage + lifecycle trace events', () => {
    const { campaign, goal } = seedCampaignGoal();
    const fake = makeFakeChild();
    const spawnSpy = mock.fn(() => fake);
    const out = spawnGoalRun(campaign, goal, { spawn: spawnSpy });

    assert.ok(out.run.id);
    assert.strictEqual(out.link.campaign_id, campaign.id);
    assert.strictEqual(out.link.goal_id, goal.id);
    assert.strictEqual(out.link.worker_backend, 'codex-exec');
    assert.strictEqual(spawnSpy.mock.callCount(), 1);

    // The spawner is called with the safe-default flags.
    const [bin, args] = spawnSpy.mock.calls[0].arguments;
    assert.strictEqual(bin, 'codex');
    assert.deepStrictEqual(args.slice(0, 5),
      ['exec', '--sandbox', 'workspace-write', '--ask-for-approval', 'never']);
    assert.strictEqual(args[5], '--cd');
    assert.ok(args[6]);  // workdir
    assert.strictEqual(args[7], goal.prompt);

    const events = getTraceEvents(out.run.id, { limit: 100 });
    const types = events.map((e) => e.type);
    assert.ok(types.includes('worker.spawned'));
    assert.ok(types.includes('goal.started'));
  });

  test('child stdout/stderr → artifacts; exit 0 → run completed + goal.completed event', () => {
    const { campaign, goal } = seedCampaignGoal();
    const fake = makeFakeChild();
    const out = spawnGoalRun(campaign, goal, { spawn: () => fake });

    fake.stdout.emit('data', Buffer.from('hello from codex\n'));
    fake.stderr.emit('data', Buffer.from('a warning\n'));
    fake.emit('close', 0);

    const arts = getArtifactsForRun(out.run.id);
    assert.ok(arts.find((a) => a.title === 'codex stdout'));
    assert.ok(arts.find((a) => a.title === 'codex stderr'));

    const run = getRun(out.run.id);
    assert.strictEqual(run.status, 'completed');

    const types = getTraceEvents(out.run.id, { limit: 100 }).map((e) => e.type);
    assert.ok(types.includes('goal.completed'));
  });

  test('non-zero exit → failRun + goal.failed', () => {
    const { campaign, goal } = seedCampaignGoal();
    const fake = makeFakeChild();
    const out = spawnGoalRun(campaign, goal, { spawn: () => fake });

    fake.stderr.emit('data', Buffer.from('boom\n'));
    fake.emit('close', 7);

    const run = getRun(out.run.id);
    assert.strictEqual(run.status, 'failed');
    const types = getTraceEvents(out.run.id, { limit: 100 }).map((e) => e.type);
    assert.ok(types.includes('goal.failed'));
  });

  test('spawn throw → failRun + recorded trace event', () => {
    const { campaign, goal } = seedCampaignGoal();
    const out = spawnGoalRun(campaign, goal, {
      spawn: () => { throw new Error('ENOENT'); },
    });
    const run = getRun(out.run.id);
    assert.strictEqual(run.status, 'failed');
  });
});
