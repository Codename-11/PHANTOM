import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDB, closeDB, createConversation, createRun, getRun, addTraceEvent, getTraceEvents, getArtifactsForRun } from './memory/store.js';
import { createScope } from './scope/scope-store.js';
import { createPromptProfile, createPromptFragment, resolvePrompt } from './prompts/prompt-store.js';
import { writeArtifact } from './artifacts/artifact-store.js';
import { executeTool } from './tools/executor.js';
import { updateConfig } from './config.js';

let tempDir;

describe('replay guarantees', () => {
  afterEach(() => {
    closeDB();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  test('runs, ordered traces, artifacts, scope metadata, and prompt snapshots reopen after DB restart', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'phantom-replay-'));
    const dbPath = join(tempDir, 'replay.db');
    updateConfig({ workspace: join(tempDir, 'workspace') });
    initDB(dbPath);

    const conversation = createConversation('Replay restart');
    const scope = createScope({
      name: 'Replay Scope',
      targets: { hosts: ['127.0.0.1'] },
      allowedActions: ['read/local'],
      credentialRefs: ['vault:do-not-leak'],
      notes: 'Replay ROE',
    });
    const profile = createPromptProfile({ name: 'Replay Profile', mode: 'replay' });
    createPromptFragment({ profileId: profile.id, kind: 'mode', name: 'Replay Mode', body: 'Replay mode fragment.' });
    const resolved = resolvePrompt({ basePrompt: 'BASE', profileId: profile.id, scopeId: scope.id });
    const run = createRun({
      conversationId: conversation.id,
      title: 'Replay Run',
      goal: 'prove durable replay',
      model: 'grok-4.3',
      providerRoute: 'hermes-proxy',
      scopeId: scope.id,
      promptSnapshot: resolved.snapshot,
    });

    const start = addTraceEvent(run.id, { type: 'run.started', status: 'started', outputPreview: 'start' });
    const toolStarted = addTraceEvent(run.id, { type: 'tool.call.started', phase: 'tool', status: 'started', toolName: 'read_file', input: { path: '/tmp/example' }, metadata: { toolCallId: 'call-replay' } });
    const toolCompleted = addTraceEvent(run.id, { type: 'tool.call.completed', phase: 'tool', status: 'completed', toolName: 'read_file', outputPreview: 'file content', metadata: { toolCallId: 'call-replay', parentSeq: toolStarted.seq } });
    addTraceEvent(run.id, { type: 'run.completed', status: 'completed', outputPreview: 'done' });
    const artifact = writeArtifact({
      runId: run.id,
      conversationId: conversation.id,
      type: 'markdown',
      title: 'Replay artifact',
      mimeType: 'text/markdown',
      extension: '.md',
      content: '# replay artifact',
      metadata: { traceEventId: toolCompleted.id, source: 'replay-test' },
    });
    assert.ok(start.id);
    assert.ok(artifact.path);

    closeDB();
    initDB(dbPath);

    const reopenedRun = getRun(run.id);
    assert.strictEqual(reopenedRun.id, run.id);
    assert.strictEqual(reopenedRun.scope.id, scope.id);
    assert.strictEqual(reopenedRun.scope.name, 'Replay Scope');
    assert.strictEqual(reopenedRun.prompt_snapshot.profile.name, 'Replay Profile');
    assert.ok(reopenedRun.prompt_snapshot.resolvedPrompt.includes('Replay mode fragment.'));
    assert.ok(!JSON.stringify(reopenedRun).includes('vault:do-not-leak'));

    const events = getTraceEvents(run.id);
    assert.deepStrictEqual(events.map(event => event.seq), [1, 2, 3, 4]);
    assert.deepStrictEqual(events.map(event => event.type), ['run.started', 'tool.call.started', 'tool.call.completed', 'run.completed']);
    assert.strictEqual(events[1].metadata.toolCallId, 'call-replay');
    assert.strictEqual(events[2].metadata.toolCallId, 'call-replay');

    const artifacts = getArtifactsForRun(run.id);
    assert.strictEqual(artifacts.length, 1);
    assert.strictEqual(artifacts[0].id, artifact.id);
    assert.strictEqual(artifacts[0].metadata.traceEventId, toolCompleted.id);
  });

  test('direct traced tool execution emits complete ordered lifecycle events', async () => {
    initDB(':memory:');
    const conversation = createConversation('Direct tool replay');
    const run = createRun({ conversationId: conversation.id, title: 'Direct tool', goal: 'trace direct tool calls' });

    const result = await executeTool('python_execute', { code: 'print(40 + 2)' }, null, {
      trace: (event) => addTraceEvent(run.id, event),
    });

    assert.match(result, /42/);
    const events = getTraceEvents(run.id);
    assert.deepStrictEqual(events.map(event => event.type), ['tool.call.started', 'tool.call.completed']);
    assert.deepStrictEqual(events.map(event => event.seq), [1, 2]);
    assert.strictEqual(events[0].tool_name, 'python_execute');
    assert.strictEqual(events[1].status, 'completed');
    assert.match(events[1].output_preview, /42/);
  });
});
