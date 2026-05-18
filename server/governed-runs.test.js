import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { initDB, closeDB, createConversation, createRun, getRun, addTraceEvent, getTraceEvents } from './memory/store.js';
import { createScope } from './scope/scope-store.js';
import { createPromptProfile, createPromptFragment, resolvePrompt } from './prompts/prompt-store.js';
import { executeTool } from './tools/executor.js';

describe('governed run integration', () => {
  afterEach(() => closeDB());

  test('run creation stores selected scope and redacted prompt/config snapshot', () => {
    initDB(':memory:');
    const conv = createConversation('Governed run');
    const scope = createScope({ name: 'Allowed lab', targets: { hosts: ['example.com'] }, credentialRefs: ['vault:prod-token'], notes: 'ROE notes' });
    const profile = createPromptProfile({ name: 'Web app', mode: 'web' });
    createPromptFragment({ profileId: profile.id, kind: 'mode', name: 'Web mode', body: 'Web testing only.' });
    const resolved = resolvePrompt({ basePrompt: 'BASE', profileId: profile.id, scopeId: scope.id });

    const run = createRun({
      conversationId: conv.id,
      title: 'Governed',
      goal: 'test',
      model: 'grok-4.3',
      providerRoute: 'hermes-proxy',
      scopeId: scope.id,
      promptSnapshot: resolved.snapshot,
    });

    const saved = getRun(run.id);
    assert.strictEqual(saved.scope_id, scope.id);
    assert.strictEqual(saved.scope?.name, 'Allowed lab');
    assert.strictEqual(saved.prompt_snapshot.profile.name, 'Web app');
    assert.ok(saved.prompt_snapshot.resolvedPrompt.includes('Web testing only.'));
    assert.ok(!JSON.stringify(saved).includes('vault:prod-token'));
  });

  test('blocked tool decision does not execute command and persists trace event', async () => {
    initDB(':memory:');
    const conv = createConversation('Blocked run');
    const scope = createScope({ name: 'Local only', targets: { hosts: ['127.0.0.1'] }, allowedActions: ['network-scan'] });
    const run = createRun({ conversationId: conv.id, goal: 'scan', scopeId: scope.id });
    const result = await executeTool('execute_command', { command: 'echo SHOULD_NOT_RUN && nmap 10.0.0.5' }, null, {
      scope,
      runId: run.id,
      trace: (event) => addTraceEvent(run.id, event),
    });

    assert.match(result, /Blocked by PHANTOM scope policy/);
    assert.doesNotMatch(result, /SHOULD_NOT_RUN/);
    const events = getTraceEvents(run.id);
    assert.ok(events.some(event => event.type === 'tool.call.blocked'));
    assert.strictEqual(events.find(event => event.type === 'tool.call.blocked').metadata.risk, 'network-scan');
  });

  test('Operator Override runs risky commands without scope and persists override audit event', async () => {
    initDB(':memory:');
    const conv = createConversation('Override run');
    const run = createRun({
      conversationId: conv.id,
      goal: 'override scan smoke',
      promptSnapshot: {
        governance: {
          policyMode: 'operator-override',
          operatorOverride: { enabled: true, reason: 'local integration testing' },
        },
      },
    });

    const result = await executeTool('execute_command', { command: 'printf OPERATOR_OVERRIDE_RAN && nmap 10.0.0.5' }, null, {
      scope: null,
      runId: run.id,
      operatorOverride: { enabled: true, reason: 'local integration testing' },
      trace: (event) => addTraceEvent(run.id, event),
    });

    assert.match(result, /OPERATOR_OVERRIDE_RAN/);
    const events = getTraceEvents(run.id);
    const overrideEvent = events.find(event => event.type === 'tool.call.override');
    assert.ok(overrideEvent, 'expected an explicit override audit trace event');
    assert.strictEqual(overrideEvent.metadata.policyMode, 'operator-override');
    assert.strictEqual(overrideEvent.metadata.decision.allowed, true);
    assert.strictEqual(overrideEvent.metadata.decision.risk, 'network-scan');
    assert.strictEqual(overrideEvent.metadata.operatorOverride.reason, 'local integration testing');
    assert.ok(!events.some(event => event.type === 'tool.call.blocked'));

    const saved = getRun(run.id);
    assert.strictEqual(saved.prompt_snapshot.governance.policyMode, 'operator-override');
    assert.strictEqual(saved.prompt_snapshot.governance.operatorOverride.reason, 'local integration testing');
  });
});
