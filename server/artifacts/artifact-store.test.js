import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import config, { updateConfig } from '../config.js';
import { initDB, closeDB, createConversation, createRun, addTraceEvent } from '../memory/store.js';
import { writeArtifact, exportRunTrace } from './artifact-store.js';

let tempWorkspace;

function resetWorkspace() {
  tempWorkspace = mkdtempSync(join(tmpdir(), 'phantom-artifacts-'));
  updateConfig({ workspace: tempWorkspace });
}

describe('Artifact storage', () => {
  afterEach(() => {
    closeDB();
    if (tempWorkspace) rmSync(tempWorkspace, { recursive: true, force: true });
    tempWorkspace = null;
  });

  test('writeArtifact stores content under workspace/runs/<run-id>/artifacts and creates metadata', () => {
    resetWorkspace();
    initDB(':memory:');
    const conv = createConversation('Preview artifact');
    const run = createRun({ conversationId: conv.id, title: 'Preview', goal: 'Preview', model: 'grok-4.3', providerRoute: 'hermes-proxy' });

    const artifact = writeArtifact({
      runId: run.id,
      conversationId: conv.id,
      type: 'html',
      title: 'Preview Card',
      mimeType: 'text/html',
      extension: '.html',
      content: '<h1>Durable Preview</h1>',
      metadata: { source: 'show_preview_window' },
    });

    assert.ok(artifact.id);
    assert.strictEqual(artifact.type, 'html');
    assert.ok(artifact.path.startsWith(join(config.workspace, 'runs', run.id, 'artifacts')));
    assert.ok(existsSync(artifact.path));
    assert.strictEqual(readFileSync(artifact.path, 'utf8'), '<h1>Durable Preview</h1>');
    assert.deepStrictEqual(artifact.metadata, { source: 'show_preview_window' });
  });

  test('exportRunTrace writes ordered trace.jsonl and records an artifact', () => {
    resetWorkspace();
    initDB(':memory:');
    const conv = createConversation('Trace artifact');
    const run = createRun({ conversationId: conv.id, title: 'Trace', goal: 'Trace', model: 'grok-4.3', providerRoute: 'hermes-proxy' });
    addTraceEvent(run.id, { type: 'run.started', outputPreview: 'start' });
    addTraceEvent(run.id, { type: 'run.completed', outputPreview: 'done' });

    const artifact = exportRunTrace(run.id, conv.id);

    assert.strictEqual(artifact.type, 'jsonl');
    assert.strictEqual(artifact.title, 'Trace log');
    const tracePath = join(config.workspace, 'runs', run.id, 'trace.jsonl');
    assert.strictEqual(artifact.path, tracePath);
    assert.ok(existsSync(tracePath));
    const lines = readFileSync(tracePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepStrictEqual(lines.map(line => line.type), ['run.started', 'run.completed']);
    assert.deepStrictEqual(lines.map(line => line.seq), [1, 2]);
  });
});
