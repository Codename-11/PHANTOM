import { initDB, closeDB, getDB, createConversation, createRun, addTraceEvent } from '../../server/memory/store.js';
import { createScope } from '../../server/scope/scope-store.js';
import { writeArtifact } from '../../server/artifacts/artifact-store.js';

initDB();
const db = getDB();

for (const row of db.prepare("SELECT id FROM conversations WHERE title LIKE 'SMOKE Graph Viewer%' ").all()) {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(row.id);
}
db.prepare("DELETE FROM scopes WHERE name LIKE 'SMOKE Graph Viewer%' ").run();

const scope = createScope({
  name: 'SMOKE Graph Viewer Scope',
  targets: {
    hosts: ['viewer.local', '127.0.0.1'],
    urls: ['http://viewer.local:8080/health'],
    cidrs: ['127.0.0.0/8'],
  },
  allowedActions: ['read/local', 'recon', 'network-scan'],
  blockedActions: ['destructive', 'exploit'],
  notes: 'Disposable graph viewer smoke fixture. Contains synthetic trace events only.',
});

const conversation = createConversation('SMOKE Graph Viewer — live operational canvas');
const run = createRun({
  conversationId: conversation.id,
  title: 'SMOKE Graph Viewer — live operational canvas',
  goal: 'Verify first-class graph viewer rendering, blocked paths, pan/zoom controls, and live follow state.',
  model: 'smoke-fixture',
  providerRoute: 'local-fixture',
  scopeId: scope.id,
  riskLevel: 'medium',
  promptSnapshot: {
    resolvedPrompt: '[REDACTED smoke prompt]',
    scope: { id: scope.id, name: scope.name },
    config: { model: 'smoke-fixture', providerRoute: 'local-fixture' },
  },
});

addTraceEvent(run.id, {
  type: 'run.started',
  phase: 'recon',
  status: 'started',
  outputPreview: run.goal,
  metadata: { scopeId: scope.id, fixture: true },
});

const allowed = addTraceEvent(run.id, {
  type: 'tool.call.started',
  phase: 'recon',
  status: 'started',
  toolName: 'execute_command',
  input: { command: 'curl -I http://viewer.local:8080/health' },
  metadata: { toolCallId: 'smoke-allowed', risk: 'recon', scopeId: scope.id },
});

addTraceEvent(run.id, {
  parentEventId: allowed.id,
  type: 'tool.call.completed',
  phase: 'recon',
  status: 'completed',
  toolName: 'execute_command',
  input: { command: 'curl -I http://viewer.local:8080/health' },
  outputPreview: 'HTTP/1.1 200 OK from http://viewer.local:8080/health; observed 127.0.0.1:1337',
  metadata: { toolCallId: 'smoke-allowed', risk: 'recon', allowed: true, scopeId: scope.id },
  durationMs: 35,
});

const blocked = addTraceEvent(run.id, {
  type: 'tool.call.started',
  phase: 'scan',
  status: 'started',
  toolName: 'execute_command',
  input: { command: 'nmap -Pn -p 80 10.255.255.11' },
  metadata: { toolCallId: 'smoke-blocked', risk: 'network-scan', scopeId: scope.id },
});

addTraceEvent(run.id, {
  parentEventId: blocked.id,
  type: 'tool.call.blocked',
  phase: 'scan',
  status: 'skipped',
  toolName: 'execute_command',
  input: { command: 'nmap -Pn -p 80 10.255.255.11' },
  outputPreview: 'Blocked by PHANTOM scope policy: target outside selected scope: 10.255.255.11',
  metadata: {
    toolCallId: 'smoke-blocked',
    risk: 'network-scan',
    scopeId: scope.id,
    decision: {
      allowed: false,
      reason: 'target outside selected scope',
      targets: ['10.255.255.11'],
      risk: 'network-scan',
    },
  },
  durationMs: 0,
});

const artifact = writeArtifact({
  runId: run.id,
  conversationId: conversation.id,
  type: 'markdown',
  title: 'SMOKE graph viewer evidence',
  mimeType: 'text/markdown',
  extension: '.md',
  content: '# SMOKE graph viewer evidence\n\nSynthetic fixture for operational graph UI. No real scan executed.\n',
  metadata: { source: 'graph_viewer_smoke' },
});

addTraceEvent(run.id, {
  type: 'artifact.created',
  phase: 'artifact',
  status: 'completed',
  outputPreview: artifact.title,
  metadata: { artifactId: artifact.id, source: 'graph_viewer_smoke' },
});

closeDB();
console.log(JSON.stringify({ runId: run.id, scopeId: scope.id, artifactId: artifact.id }));
