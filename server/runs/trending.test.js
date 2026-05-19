import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDB, closeDB, getDB,
  createConversation, createRun, updateRunStatus, addTraceEvent,
} from '../memory/store.js';
import { createScope } from '../scope/scope-store.js';
import { getPostureTrend } from './trending.js';

let conv;
let scopeA;
let scopeB;

// SQLite's CURRENT_TIMESTAMP has 1s resolution, so back-to-back runs share
// a started_at and getRuns can return them in indeterminate order. We
// override started_at and ended_at directly so the tests have stable,
// strictly-monotonic timestamps to assert against.
let timeOffset = 0;
function nextTimestamps() {
  const base = new Date('2026-05-01T00:00:00Z').getTime();
  const startedAt = new Date(base + timeOffset * 60_000).toISOString().replace('T', ' ').slice(0, 19);
  const endedAt   = new Date(base + timeOffset * 60_000 + 5_000).toISOString().replace('T', ' ').slice(0, 19);
  timeOffset += 1;
  return { startedAt, endedAt };
}

function completedRun({ title, scopeId, succeeded = 1, failed = 0, blocked = 0 }) {
  const run = createRun({ conversationId: conv.id, title, goal: title, scopeId });
  for (let i = 0; i < succeeded; i++) {
    addTraceEvent(run.id, { type: 'tool.call.started', toolName: 'web_request', metadata: { toolCallId: `s${run.id}${i}` } });
    addTraceEvent(run.id, { type: 'tool.call.completed', toolName: 'web_request', metadata: { toolCallId: `s${run.id}${i}` } });
  }
  for (let i = 0; i < failed; i++) {
    addTraceEvent(run.id, { type: 'tool.call.started', toolName: 'web_request', metadata: { toolCallId: `f${run.id}${i}` } });
    addTraceEvent(run.id, { type: 'tool.call.failed',  toolName: 'web_request', metadata: { toolCallId: `f${run.id}${i}` } });
  }
  for (let i = 0; i < blocked; i++) {
    addTraceEvent(run.id, { type: 'tool.call.blocked', toolName: 'execute_command', metadata: { risk: 'high', toolCallId: `b${run.id}${i}` } });
  }
  const { startedAt, endedAt } = nextTimestamps();
  updateRunStatus(run.id, 'completed', { summary: 'ok', endedAt });
  getDB().prepare('UPDATE runs SET started_at = ?, ended_at = ? WHERE id = ?').run(startedAt, endedAt, run.id);
  return run;
}

before(() => {
  initDB(':memory:');
  conv = createConversation('Trend test');
  scopeA = createScope({ name: 'Scope A', targets: { hosts: ['10.0.0.1'] }, allowedActions: ['recon'] });
  scopeB = createScope({ name: 'Scope B', targets: { hosts: ['10.0.0.2'] }, allowedActions: ['recon'] });
});

after(() => { closeDB(); });

test('returns empty trend when there are no runs', () => {
  const trend = getPostureTrend({ limit: 5 });
  assert.equal(trend.runsConsidered, 0);
  assert.equal(trend.current, null);
  assert.equal(trend.baseline, null);
  assert.deepEqual(trend.sparkline, []);
  assert.deepEqual(trend.byScope, []);
});

test('captures sparkline, current, baseline, and delta across runs', () => {
  // Run 1: clean → high posture. Run 2: blocked high-risk → lower posture.
  completedRun({ title: 'recon-1', scopeId: scopeA.id, succeeded: 3 });
  completedRun({ title: 'recon-2', scopeId: scopeA.id, succeeded: 2, blocked: 2 });
  const trend = getPostureTrend({ limit: 10 });
  assert.equal(trend.runsConsidered, 2);
  assert.ok(trend.sparkline[0].score >= trend.sparkline[1].score,
    'chronological order — older first, so r1 >= r2 after blocks');
  assert.equal(trend.baseline, trend.sparkline[0].score);
  assert.equal(trend.current,  trend.sparkline[trend.sparkline.length - 1].score);
  assert.equal(trend.delta, trend.current - trend.baseline);
  assert.ok(trend.sparkline[1].delta != null, 'delta is filled for non-first entries');
  assert.equal(trend.sparkline[0].delta, null, 'first entry has no delta to compare against');
});

test('scopeId filter narrows the trend', () => {
  // Add a run in scope B so byScope groups two distinct buckets.
  completedRun({ title: 'b-1', scopeId: scopeB.id, succeeded: 1 });
  const all = getPostureTrend({ limit: 10 });
  assert.ok(all.byScope.length >= 2, 'byScope groups multiple scopes');
  const filtered = getPostureTrend({ scopeId: scopeA.id, limit: 10 });
  assert.ok(filtered.recentRuns.every(r => r.scope?.id === scopeA.id),
    'filtered trend only contains the requested scope');
});

test('byScope rows include current score and per-scope delta', () => {
  const trend = getPostureTrend({ limit: 10 });
  const scopeA_row = trend.byScope.find(s => s.scopeId === scopeA.id);
  assert.ok(scopeA_row, 'scope A appears in byScope');
  assert.equal(typeof scopeA_row.current, 'number');
  assert.ok(scopeA_row.runs >= 2);
  // We added two scope-A runs (clean, then blocked), so delta should be ≤ 0.
  assert.ok(scopeA_row.delta != null && scopeA_row.delta <= 0,
    'second run is worse than first, so per-scope delta is ≤ 0');
});

test('recentRuns are reverse-chronological for UI consumption', () => {
  const trend = getPostureTrend({ limit: 10 });
  for (let i = 1; i < trend.recentRuns.length; i++) {
    const prev = trend.recentRuns[i - 1];
    const cur  = trend.recentRuns[i];
    if (prev.endedAt && cur.endedAt) {
      assert.ok(new Date(prev.endedAt) >= new Date(cur.endedAt),
        'recentRuns are newest-first');
    }
  }
});

test('non-terminal runs are excluded', () => {
  const conv2 = createConversation('Non-terminal');
  createRun({ conversationId: conv2.id, title: 'still running', goal: 'pending' }); // status defaults to 'running'
  const trend = getPostureTrend({ limit: 10 });
  assert.ok(!trend.sparkline.some(r => r.title === 'still running'),
    'running runs do not appear in the trend');
});
