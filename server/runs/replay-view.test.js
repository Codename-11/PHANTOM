import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDB, closeDB, createConversation, createRun, addTraceEvent } from '../memory/store.js';
import { writeArtifact } from '../artifacts/artifact-store.js';
import { updateConfig } from '../config.js';
import { buildRunReplay } from './replay.js';

let tempDir;

describe('run replay presentation model', () => {
  afterEach(() => {
    closeDB();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  test('buildRunReplay returns ordered operator steps linked to graph nodes, output, policy, and artifacts', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'phantom-replay-view-'));
    updateConfig({ workspace: join(tempDir, 'workspace') });
    initDB(join(tempDir, 'replay-view.db'));

    const conversation = createConversation('Replay viewer');
    const run = createRun({ conversationId: conversation.id, title: 'Very long replay viewer title that should remain inspectable', goal: 'inspect replay path' });
    addTraceEvent(run.id, { type: 'run.started', status: 'started', outputPreview: 'Starting replay viewer run' });
    const started = addTraceEvent(run.id, {
      type: 'tool.call.started',
      phase: 'recon',
      status: 'started',
      toolName: 'execute_command',
      input: { command: 'curl -I http://viewer.example.test/health' },
      metadata: { toolCallId: 'call-viewer', risk: 'recon' },
    });
    const completed = addTraceEvent(run.id, {
      parentEventId: started.id,
      type: 'tool.call.completed',
      phase: 'recon',
      status: 'completed',
      toolName: 'execute_command',
      input: { command: 'curl -I http://viewer.example.test/health' },
      outputPreview: 'HTTP/1.1 200 OK from http://viewer.example.test/health',
      metadata: { toolCallId: 'call-viewer', risk: 'recon' },
    });
    const artifact = writeArtifact({
      runId: run.id,
      conversationId: conversation.id,
      type: 'markdown',
      title: 'Replay viewer evidence',
      mimeType: 'text/markdown',
      extension: '.md',
      content: '# evidence',
      metadata: { traceEventId: completed.id, token: 'do-not-leak' },
    });
    addTraceEvent(run.id, {
      type: 'tool.call.blocked',
      phase: 'scan',
      status: 'skipped',
      toolName: 'execute_command',
      input: { command: 'nmap 203.0.113.5' },
      outputPreview: 'Blocked by PHANTOM scope policy: target outside selected scope',
      metadata: { toolCallId: 'blocked-viewer', risk: 'network-scan', decision: { allowed: false, reason: 'target outside selected scope', targets: ['203.0.113.5'] } },
    });
    addTraceEvent(run.id, { type: 'run.completed', status: 'completed', outputPreview: 'Done' });

    const bundle = buildRunReplay(run.id);

    assert.ok(Array.isArray(bundle.replay.steps));
    assert.deepStrictEqual(bundle.replay.steps.map(step => step.seq), [1, 2, 3, 4, 5]);

    const completedStep = bundle.replay.steps.find(step => step.eventId === completed.id);
    assert.strictEqual(completedStep.title, 'Shell command completed');
    assert.match(completedStep.outputPreview, /HTTP\/1\.1 200 OK/);
    assert.ok(completedStep.primaryNodeId.startsWith('tool:'));
    assert.ok(completedStep.nodeIds.some(id => id.startsWith('command:')));
    assert.ok(completedStep.artifacts.some(item => item.id === artifact.id));
    assert.ok(!JSON.stringify(completedStep).includes('do-not-leak'));

    const blockedStep = bundle.replay.steps.find(step => step.status === 'blocked');
    assert.strictEqual(blockedStep.title, 'Shell command blocked');
    assert.strictEqual(blockedStep.policy.allowed, false);
    assert.match(blockedStep.explanation, /target outside selected scope/i);
    assert.ok(blockedStep.nodeIds.some(id => id.includes('203.0.113.5')));
  });
});
