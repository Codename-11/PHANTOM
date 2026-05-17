import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import {
  initDB, getDB, closeDB,
  createConversation,
  createRun, getRun, getRuns, updateRunStatus,
  addTraceEvent, getTraceEvents,
  createArtifact, getArtifact, getArtifacts, getArtifactsForRun,
} from './store.js';

describe('Database Store Initialization', () => {
  after(() => {
    closeDB();
  });

  test('initDB should initialize an in-memory database with correct schema', () => {
    const db = initDB(':memory:');

    // Check tables
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    const expectedTables = [
      'conversations',
      'messages',
      'memories',
      'settings',
      'mcp_servers',
      'tool_results',
      'runs',
      'scopes',
      'prompt_profiles',
      'prompt_fragments',
      'trace_events',
      'artifacts'
    ];

    for (const table of expectedTables) {
      assert.ok(tables.includes(table), `Table ${table} should exist`);
    }

    // Check indices
    const indices = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
    const expectedIndices = [
      'idx_messages_conversation',
      'idx_memories_category',
      'idx_memories_key',
      'idx_runs_conversation',
      'idx_runs_status',
      'idx_runs_scope',
      'idx_scopes_archived',
      'idx_prompt_fragments_profile',
      'idx_trace_events_run_seq',
      'idx_artifacts_run'
    ];

    for (const index of expectedIndices) {
      assert.ok(indices.includes(index), `Index ${index} should exist`);
    }
  });

  test('initDB should set foreign_keys pragma', () => {
    const db = initDB(':memory:');

    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    assert.strictEqual(foreignKeys, 1);
  });

  test('getDB should return the database instance', () => {
    const db1 = initDB(':memory:');
    const db2 = getDB();
    assert.strictEqual(db1, db2, 'getDB should return the current database instance');
  });

  test('runs and trace events should persist ordered run telemetry', () => {
    initDB(':memory:');
    const conv = createConversation('Run telemetry test');
    const run = createRun({
      conversationId: conv.id,
      title: 'Inspect local host',
      goal: 'Check local host health',
      model: 'grok-4.3',
      providerRoute: 'hermes-proxy',
    });

    assert.ok(run.id, 'run should have an id');
    assert.strictEqual(run.status, 'running');
    assert.strictEqual(run.conversation_id, conv.id);

    const first = addTraceEvent(run.id, {
      type: 'run.started',
      phase: 'general',
      status: 'started',
      outputPreview: 'Run started',
    });
    const second = addTraceEvent(run.id, {
      parentEventId: first.id,
      type: 'tool.call.started',
      phase: 'general',
      status: 'started',
      toolName: 'execute_command',
      input: { command: 'hostname' },
    });

    assert.strictEqual(first.seq, 1);
    assert.strictEqual(second.seq, 2);

    updateRunStatus(run.id, 'completed', { summary: 'Done' });
    const savedRun = getRun(run.id);
    assert.strictEqual(savedRun.status, 'completed');
    assert.strictEqual(savedRun.summary, 'Done');
    assert.ok(savedRun.ended_at, 'completed run should have ended_at');

    const events = getTraceEvents(run.id);
    assert.strictEqual(events.length, 2);
    assert.deepStrictEqual(events.map(e => e.seq), [1, 2]);
    assert.deepStrictEqual(events[1].input, { command: 'hostname' });

    const runs = getRuns({ limit: 5 });
    assert.ok(runs.some(r => r.id === run.id), 'run should appear in run list');
  });

  test('artifacts should persist metadata and stay queryable by run', () => {
    initDB(':memory:');
    const conv = createConversation('Artifact test');
    const run = createRun({
      conversationId: conv.id,
      title: 'Generate preview',
      goal: 'Create durable preview',
      model: 'grok-4.3',
      providerRoute: 'hermes-proxy',
    });

    const artifact = createArtifact({
      runId: run.id,
      conversationId: conv.id,
      type: 'html',
      title: 'Preview Window',
      mimeType: 'text/html',
      path: '/tmp/phantom-preview.html',
      metadata: { source: 'show_preview_window', traceEventId: 'evt-1' },
    });

    assert.ok(artifact.id, 'artifact should have an id');
    assert.strictEqual(artifact.run_id, run.id);
    assert.strictEqual(artifact.conversation_id, conv.id);
    assert.deepStrictEqual(artifact.metadata, { source: 'show_preview_window', traceEventId: 'evt-1' });

    const saved = getArtifact(artifact.id);
    assert.strictEqual(saved.title, 'Preview Window');
    assert.strictEqual(saved.mime_type, 'text/html');

    const runArtifacts = getArtifactsForRun(run.id);
    assert.strictEqual(runArtifacts.length, 1);
    assert.strictEqual(runArtifacts[0].id, artifact.id);

    const allArtifacts = getArtifacts({ limit: 5 });
    assert.ok(allArtifacts.some(a => a.id === artifact.id));
  });
});
