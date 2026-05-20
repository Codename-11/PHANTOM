import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDB, closeDB, createConversation, createRun, completeRun, addTraceEvent,
} from '../memory/store.js';
import { createScope } from '../scope/scope-store.js';
import { buildRunEvidence, renderEvidenceMarkdown } from './evidence-builder.js';
import { findLeaks } from './evidence-redactor.js';

function seedRunWithSecrets() {
  initDB(':memory:');
  const scope = createScope({
    name: 'Test scope',
    targets: { hosts: ['x'] },
    allowedActions: ['recon'],
    blockedActions: ['exploit'],
  });
  const conv = createConversation('test');
  const run = createRun({
    conversationId: conv.id,
    title: 'Secret-laden run',
    goal: 'demo',
    model: 'gpt-4o',
    scopeId: scope.id,
    // Prompt snapshot has a secret in it that the redactor must strip.
    promptSnapshot: { apiKey: 'sk-MyVeryRealSecret1234567890', user: 'alice' },
  });
  addTraceEvent(run.id, {
    type: 'tool.call.completed', phase: 'recon', status: 'completed', toolName: 'http_headers',
    outputPreview: 'Authorization: Bearer eyJabcdef1234567890ghijklmnop',
  });
  addTraceEvent(run.id, {
    type: 'tool.call.blocked', phase: 'gate', status: 'blocked', toolName: 'hydra',
    metadata: { risk: 'online-bruteforce', reason: 'denied by scope' },
  });
  completeRun(run.id, 'Done — final api key was sk-anotherleak98765432100', { tokens_used: 0 });
  return { run, scope };
}

describe('evidence-builder', () => {
  afterEach(() => closeDB());

  test('buildRunEvidence: returns the expected shape', () => {
    const { run } = seedRunWithSecrets();
    const ev = buildRunEvidence(run.id);
    assert.strictEqual(ev.run.id, run.id);
    assert.strictEqual(ev.run.title, 'Secret-laden run');
    assert.ok(ev.scope);
    assert.ok(ev.promptSnapshot);
    assert.ok(Array.isArray(ev.events));
    assert.ok(Array.isArray(ev.artifacts));
    assert.ok(Array.isArray(ev.findings));
    assert.ok(ev.summary);
    assert.strictEqual(ev.summary.eventCount, ev.events.length);
    assert.strictEqual(ev.summary.blockedCount, 1);
  });

  test('buildRunEvidence: throws on unknown id', () => {
    initDB(':memory:');
    assert.throws(() => buildRunEvidence('no-such-run'), /run not found/);
  });

  test('buildRunEvidence: bundle has zero leaks after redaction', () => {
    const { run } = seedRunWithSecrets();
    const ev = buildRunEvidence(run.id);
    const leaks = findLeaks(ev);
    assert.deepEqual(leaks, [], `bundle leaked: ${JSON.stringify(leaks, null, 2)}`);
  });

  test('renderEvidenceMarkdown: contains the run header + roll-up + no raw secrets', () => {
    const { run } = seedRunWithSecrets();
    const ev = buildRunEvidence(run.id);
    const md = renderEvidenceMarkdown(ev);
    assert.match(md, /# Run evidence/);
    assert.match(md, /## Roll-up/);
    assert.match(md, /Tool calls/);
    assert.match(md, /Blocked actions/);
    // No raw secret shapes anywhere in the output
    const leaks = findLeaks(md);
    assert.deepEqual(leaks, []);
    assert.doesNotMatch(md, /sk-MyVeryRealSecret/);
    assert.doesNotMatch(md, /sk-anotherleak/);
    assert.doesNotMatch(md, /Bearer eyJabcdef/);
  });

  test('buildRunEvidence with includeRawEvents=false omits trace array', () => {
    const { run } = seedRunWithSecrets();
    const ev = buildRunEvidence(run.id, { includeRawEvents: false });
    assert.strictEqual(ev.events, null);
    // Summary counts still derive from the live trace
    assert.ok(ev.summary.eventCount >= 0);
  });
});
