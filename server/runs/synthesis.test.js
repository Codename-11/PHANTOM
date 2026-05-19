import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunSynthesis, buildStubSynthesis, enrichSynthesisWithLLM } from './synthesis.js';

function makeRun(overrides = {}) {
  return {
    id: 'run-1',
    title: 'Recon lab',
    goal: 'Sweep 10.0.0.0/24 for exposed services.',
    status: 'completed',
    started_at: '2026-05-19T12:00:00Z',
    ended_at: '2026-05-19T12:05:00Z',
    scope: { id: 'sc-1', name: 'Lab', expires_at: null, archived_at: null },
    ...overrides,
  };
}

function startedCall(seq, tool, risk = 'low', id = `t-${seq}`) {
  return {
    seq,
    type: 'tool.call.started',
    tool_name: tool,
    status: 'started',
    metadata: { toolCallId: id, risk },
  };
}

function completedCall(seq, tool, id) {
  return {
    seq,
    type: 'tool.call.completed',
    tool_name: tool,
    status: 'completed',
    metadata: { toolCallId: id },
  };
}

function failedCall(seq, tool, id) {
  return {
    seq,
    type: 'tool.call.failed',
    tool_name: tool,
    status: 'failed',
    metadata: { toolCallId: id },
    output_preview: 'connection refused',
  };
}

function blockedCall(seq, tool, risk, id) {
  return {
    seq,
    type: 'tool.call.blocked',
    tool_name: tool,
    status: 'blocked',
    metadata: { toolCallId: id, risk, decision: { reason: 'out of scope', risk } },
    output_preview: 'Blocked by policy: out of scope',
  };
}

test('rejects calls without a run id', () => {
  assert.throws(() => buildRunSynthesis({}), /requires a run/);
  assert.throws(() => buildRunSynthesis({ run: {} }), /requires a run/);
});

test('builds a synthesis for a clean completed run', () => {
  const run = makeRun();
  const events = [
    startedCall(1, 'execute_command', 'low', 'a'),
    completedCall(2, 'execute_command', 'a'),
    startedCall(3, 'web_request', 'low', 'b'),
    completedCall(4, 'web_request', 'b'),
  ];
  const artifacts = [{ id: 'art-1', type: 'json', title: 'graph' }];
  const synthesis = buildRunSynthesis({ run, events, artifacts });

  assert.equal(synthesis.v, 1);
  assert.equal(synthesis.runId, 'run-1');
  assert.equal(synthesis.status, 'completed');
  assert.equal(synthesis.activity.toolCalls.total, 2);
  assert.equal(synthesis.activity.toolCalls.succeeded, 2);
  assert.equal(synthesis.activity.toolCalls.blocked, 0);
  assert.equal(synthesis.objectives.met, 'met');
  assert.ok(synthesis.posture.score >= 50, 'clean runs land in fair-or-better posture');
  assert.equal(synthesis.posture.components.coverage, 100);
  assert.equal(synthesis.posture.delta, null);
  assert.equal(synthesis.scope.name, 'Lab');
  assert.match(synthesis.outcome, /Completed/);
  assert.ok(synthesis.highlights.some(h => h.kind === 'win'));
  assert.ok(synthesis.nextSteps.length > 0);
});

test('marks objective as partial when a tool call failed', () => {
  const events = [
    startedCall(1, 'execute_command', 'low', 'a'),
    failedCall(2, 'execute_command', 'a'),
  ];
  const synthesis = buildRunSynthesis({ run: makeRun(), events });
  assert.equal(synthesis.objectives.met, 'partial');
  assert.match(synthesis.objectives.signal, /1 failed/);
  assert.equal(synthesis.activity.toolCalls.failed, 1);
  assert.ok(synthesis.highlights.some(h => h.kind === 'note' || h.kind === 'risk'));
});

test('marks objective unmet when run failed', () => {
  const synthesis = buildRunSynthesis({
    run: makeRun({ status: 'failed' }),
    events: [],
  });
  assert.equal(synthesis.objectives.met, 'unmet');
  assert.equal(synthesis.status, 'failed');
});

test('blocked actions reduce risk score and surface as risk highlights', () => {
  const events = [
    startedCall(1, 'execute_command', 'high', 'a'),
    blockedCall(2, 'execute_command', 'high', 'a'),
  ];
  const synthesis = buildRunSynthesis({ run: makeRun(), events });
  assert.equal(synthesis.activity.toolCalls.blocked, 1);
  assert.equal(synthesis.risk.blockedHighRisk, 1);
  assert.equal(synthesis.risk.highest, 'high');
  assert.ok(synthesis.posture.components.risk < 100, 'blocked high-risk lowers risk score');
  assert.ok(synthesis.highlights.some(h => h.kind === 'risk' && /blocked/.test(h.text)));
});

test('counts approvals by decision kind', () => {
  const events = [
    { seq: 1, type: 'tool.call.approval.granted', metadata: {} },
    { seq: 2, type: 'tool.call.approval.granted', metadata: { kind: 'allow-once' } },
    { seq: 3, type: 'tool.call.approval.denied', metadata: { approval: { note: 'request timed out' } } },
    { seq: 4, type: 'tool.call.override', metadata: {} },
  ];
  const synthesis = buildRunSynthesis({ run: makeRun(), events });
  assert.equal(synthesis.policy.approvals.granted, 1);
  assert.equal(synthesis.policy.approvals.allowOnce, 1);
  assert.equal(synthesis.policy.approvals.timeout, 1);
  assert.equal(synthesis.policy.approvals.override, 1);
  assert.equal(synthesis.policy.approvals.denied, 0);
});

test('summarizes findings by severity and resolved status', () => {
  const findings = [
    { id: 'f1', severity: 'high', status: 'open' },
    { id: 'f2', severity: 'medium', status: 'fixed' },
    { id: 'f3', severity: 'low', status: 'open' },
    { id: 'f4', severity: 'critical', status: 'open' },
  ];
  const synthesis = buildRunSynthesis({ run: makeRun(), findings });
  assert.equal(synthesis.findings.total, 4);
  assert.equal(synthesis.findings.bySeverity.critical, 1);
  assert.equal(synthesis.findings.bySeverity.high, 1);
  assert.equal(synthesis.findings.resolved, 1);
  assert.equal(synthesis.findings.new, 3);
  assert.ok(synthesis.highlights.some(h => /high-severity/.test(h.text)));
});

test('posture delta is computed when previousScore is supplied', () => {
  const synthesis = buildRunSynthesis({
    run: makeRun(),
    previousScore: 50,
  });
  assert.equal(typeof synthesis.posture.delta, 'number');
  assert.equal(synthesis.posture.delta, synthesis.posture.score - 50);
});

test('falls back gracefully when no events are provided', () => {
  const synthesis = buildRunSynthesis({ run: makeRun() });
  assert.equal(synthesis.activity.events, 0);
  assert.equal(synthesis.activity.toolCalls.total, 0);
  assert.ok(synthesis.nextSteps.length > 0, 'always proposes at least one next step');
  assert.ok(synthesis.highlights.length > 0, 'always emits at least one highlight');
});

test('stub synthesis matches the v1 shape exactly', () => {
  const real = buildRunSynthesis({ run: makeRun(), events: [], artifacts: [], findings: [] });
  const stub = buildStubSynthesis();
  const keys = (obj) => Object.keys(obj).sort();
  assert.deepEqual(keys(stub), keys(real), 'stub keys mirror real synthesis');
  assert.deepEqual(keys(stub.activity), keys(real.activity));
  assert.deepEqual(keys(stub.activity.toolCalls), keys(real.activity.toolCalls));
  assert.deepEqual(keys(stub.findings.bySeverity), keys(real.findings.bySeverity));
  assert.deepEqual(keys(stub.posture.components), keys(real.posture.components));
  assert.equal(stub.v, real.v);
});

test('policy mode picks up operator-override from run snapshot', () => {
  const synthesis = buildRunSynthesis({
    run: makeRun({ prompt_snapshot: { governance: { policyMode: 'operator-override' } } }),
  });
  assert.equal(synthesis.policy.mode, 'operator-override');
});

test('duration uses ended_at when present', () => {
  const synthesis = buildRunSynthesis({ run: makeRun() });
  assert.equal(synthesis.durationMs, 5 * 60_000);
});

test('outcome string is single-line and short', () => {
  const synthesis = buildRunSynthesis({
    run: makeRun(),
    events: [
      startedCall(1, 'web_request', 'low', 'a'),
      completedCall(2, 'web_request', 'a'),
    ],
  });
  assert.ok(synthesis.outcome.length < 120);
  assert.ok(!synthesis.outcome.includes('\n'));
  assert.match(synthesis.outcome, /posture \d+\/100/);
});

// ── LLM enrichment ─────────────────────────────────────────────────────
test('enrichSynthesisWithLLM is a no-op when no llmCompleteJson provided', async () => {
  const base = buildRunSynthesis({ run: makeRun() });
  const enriched = await enrichSynthesisWithLLM(base, []);
  assert.deepEqual(enriched, base);
  assert.ok(!enriched.enrichment);
});

test('enrichSynthesisWithLLM replaces highlights + nextSteps content but keeps the shape', async () => {
  const base = buildRunSynthesis({ run: makeRun(), events: [
    startedCall(1, 'execute_command', 'low', 'a'),
    completedCall(2, 'execute_command', 'a'),
  ]});
  const stubLlm = async () => ({
    highlights: [
      { kind: 'win', text: 'Recon completed without WAF triggering — 12 subdomains enumerated.' },
      { kind: 'risk', text: 'admin.example.com returned 401 — credential testing was out of scope.' },
    ],
    nextSteps: [
      { kind: 'rerun', text: 'Re-run with credentials_audit toolpack to validate admin SSO.', action: 'rerun' },
      { kind: 'review', text: 'Inspect tool.call.failed for ffuf timeout pattern.', action: 'review-trace' },
    ],
  });
  const enriched = await enrichSynthesisWithLLM(base, [], { llmCompleteJson: stubLlm });
  // Same v1 keys.
  assert.deepEqual(Object.keys(enriched).sort().filter(k => k !== 'enrichment'), Object.keys(base).sort());
  // Posture / activity / findings unchanged.
  assert.deepEqual(enriched.posture, base.posture);
  assert.deepEqual(enriched.activity, base.activity);
  // Highlights replaced.
  assert.equal(enriched.highlights.length, 2);
  assert.match(enriched.highlights[0].text, /Recon completed/);
  assert.equal(enriched.highlights[0].kind, 'win');
  // Next steps replaced.
  assert.equal(enriched.nextSteps.length, 2);
  assert.equal(enriched.nextSteps[0].action, 'rerun');
  // Provenance marker set.
  assert.equal(enriched.enrichment.source, 'llm');
});

test('invalid LLM payload falls back to heuristic synthesis silently', async () => {
  const base = buildRunSynthesis({ run: makeRun() });
  const stubLlm = async () => ({ highlights: 'not an array', nextSteps: null });
  const enriched = await enrichSynthesisWithLLM(base, [], { llmCompleteJson: stubLlm });
  assert.deepEqual(enriched, base);
  assert.ok(!enriched.enrichment);
});

test('LLM call throwing falls back to heuristic synthesis', async () => {
  const base = buildRunSynthesis({ run: makeRun() });
  const stubLlm = async () => { throw new Error('LLM unreachable'); };
  const enriched = await enrichSynthesisWithLLM(base, [], { llmCompleteJson: stubLlm });
  assert.deepEqual(enriched, base);
});

test('enrichment validates action enum and strips unknown values', async () => {
  const base = buildRunSynthesis({ run: makeRun() });
  const stubLlm = async () => ({
    highlights: [{ kind: 'unknown-kind', text: 'should default to note' }],
    nextSteps: [{ kind: 'invalid-kind', text: 'should default to review', action: 'fly-to-mars' }],
  });
  const enriched = await enrichSynthesisWithLLM(base, [], { llmCompleteJson: stubLlm });
  assert.equal(enriched.highlights[0].kind, 'note', 'unknown highlight kind defaults to note');
  assert.equal(enriched.nextSteps[0].kind, 'review', 'unknown step kind defaults to review');
  assert.equal(enriched.nextSteps[0].action, null, 'unknown action stripped to null');
});
