import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import apiRouter from './api.js';
import {
  initDB, closeDB,
  createConversation,
  createRun,
  addTraceEvent,
  createArtifact,
} from '../memory/store.js';

let server;
let baseUrl;

describe('API Routes Integration', () => {
  before(async () => {
    initDB(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}/api`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
    closeDB();
  });

  test('GET /api/tools should return list of available tools', async () => {
    const res = await fetch(`${baseUrl}/tools`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data), 'Tools should be an array');
    assert.ok(data.length > 0, 'Should have at least one tool');
    assert.ok(data[0].name, 'Tool should have a name');
  });

  test('Conversation CRUD operations', async () => {
    // Create
    let res = await fetch(`${baseUrl}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Integration Test Conversation' })
    });
    assert.strictEqual(res.status, 200);
    const conv = await res.json();
    assert.strictEqual(conv.title, 'Integration Test Conversation');
    assert.ok(conv.id);

    const convId = conv.id;

    // Get
    res = await fetch(`${baseUrl}/conversations/${convId}`);
    assert.strictEqual(res.status, 200);
    const getConv = await res.json();
    assert.strictEqual(getConv.id, convId);

    // Update title
    res = await fetch(`${baseUrl}/conversations/${convId}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' })
    });
    assert.strictEqual(res.status, 200);

    // Delete
    res = await fetch(`${baseUrl}/conversations/${convId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 200);

    // Get (should fail)
    res = await fetch(`${baseUrl}/conversations/${convId}`);
    assert.strictEqual(res.status, 404);
  });

  test('Run and prompt preview endpoints expose telemetry without secrets', async () => {
    const conv = createConversation('API run test');
    const run = createRun({
      conversationId: conv.id,
      title: 'API Run',
      goal: 'Verify run API',
      model: 'grok-4.3',
      providerRoute: 'hermes-proxy',
    });
    addTraceEvent(run.id, {
      type: 'run.started',
      phase: 'general',
      status: 'started',
      outputPreview: 'Started via test',
    });

    let res = await fetch(`${baseUrl}/runs`);
    assert.strictEqual(res.status, 200);
    const runs = await res.json();
    assert.ok(runs.some(r => r.id === run.id));

    res = await fetch(`${baseUrl}/runs/${run.id}`);
    assert.strictEqual(res.status, 200);
    const runDetail = await res.json();
    assert.strictEqual(runDetail.id, run.id);
    assert.ok(Array.isArray(runDetail.events));
    assert.strictEqual(runDetail.events[0].type, 'run.started');
    assert.ok(Array.isArray(runDetail.artifacts));

    res = await fetch(`${baseUrl}/runs/${run.id}/events`);
    assert.strictEqual(res.status, 200);
    const events = await res.json();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].seq, 1);

    res = await fetch(`${baseUrl}/runs/${run.id}/replay`);
    assert.strictEqual(res.status, 200);
    const replay = await res.json();
    assert.strictEqual(replay.run.id, run.id);
    assert.deepStrictEqual(replay.replay.sequence, [1]);
    assert.strictEqual(replay.replay.eventCount, 1);
    assert.strictEqual(replay.replay.artifactCount, 0);
    assert.ok(Array.isArray(replay.events));
    assert.ok(replay.graph.nodes.some(node => node.type === 'run'));

    res = await fetch(`${baseUrl}/prompts/preview`);
    assert.strictEqual(res.status, 200);
    const prompt = await res.json();
    assert.ok(prompt.content.includes('You are PHANTOM'));
    assert.ok(!JSON.stringify(prompt).includes('sudo_password'));
  });

  test('Scope and prompt APIs support governed run administration', async () => {
    let res = await fetch(`${baseUrl}/scopes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'API scope',
        targets: { hosts: ['example.com'], cidrs: ['192.168.1.0/24'] },
        allowedActions: ['recon', 'network-scan'],
        blockedActions: ['destructive'],
        credentialRefs: ['vault:api-ref'],
        notes: 'API rules',
      }),
    });
    assert.strictEqual(res.status, 200);
    const scope = await res.json();
    assert.strictEqual(scope.name, 'API scope');
    assert.ok(!JSON.stringify(scope).includes('targets_json'));

    res = await fetch(`${baseUrl}/scopes/${scope.id}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName: 'execute_command', args: { command: 'nmap 10.0.0.5' } }),
    });
    assert.strictEqual(res.status, 200);
    const decision = await res.json();
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.reason, /outside selected scope/i);

    res = await fetch(`${baseUrl}/prompts/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'API profile', mode: 'recon', description: 'API prompt profile' }),
    });
    assert.strictEqual(res.status, 200);
    const profile = await res.json();

    res = await fetch(`${baseUrl}/prompts/fragments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: profile.id, kind: 'mode', name: 'API mode', body: 'API MODE FRAGMENT', position: 1 }),
    });
    assert.strictEqual(res.status, 200);
    const fragment = await res.json();
    assert.strictEqual(fragment.body, 'API MODE FRAGMENT');

    res = await fetch(`${baseUrl}/prompts/preview?profileId=${profile.id}&scopeId=${scope.id}`);
    assert.strictEqual(res.status, 200);
    const preview = await res.json();
    assert.ok(preview.content.includes('API MODE FRAGMENT'));
    assert.ok(preview.content.includes('Scope: API scope'));
    assert.ok(!JSON.stringify(preview).includes('vault:api-ref'));

    res = await fetch(`${baseUrl}/scopes/${scope.id}/archive`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
  });

  test('Artifact endpoints list metadata and serve artifact content', async () => {
    const conv = createConversation('Artifact API test');
    const run = createRun({
      conversationId: conv.id,
      title: 'Artifact API Run',
      goal: 'Verify artifact API',
      model: 'grok-4.3',
      providerRoute: 'hermes-proxy',
    });
    addTraceEvent(run.id, {
      type: 'tool.call.started',
      phase: 'tool',
      status: 'started',
      toolName: 'execute_command',
      input: { command: 'curl http://example.com:8080/status && nc -vz 10.0.0.5 22' },
      metadata: { toolCallId: 'call-api-graph' },
    });
    const completedEvent = addTraceEvent(run.id, {
      type: 'tool.call.completed',
      phase: 'tool',
      status: 'completed',
      toolName: 'execute_command',
      outputPreview: 'Connected to 10.0.0.5:22 and https://api.example.com/login',
      metadata: { toolCallId: 'call-api-graph' },
    });
    const artifact = createArtifact({
      runId: run.id,
      conversationId: conv.id,
      type: 'html',
      title: 'API Preview',
      mimeType: 'text/html',
      path: '/tmp/phantom-api-preview.html',
      metadata: { source: 'test', traceEventId: completedEvent.id, secret: 'should-not-leak-in-list' },
    });

    let res = await fetch(`${baseUrl}/artifacts?runId=${run.id}`);
    assert.strictEqual(res.status, 200);
    const artifacts = await res.json();
    assert.strictEqual(artifacts.length, 1);
    assert.strictEqual(artifacts[0].id, artifact.id);
    assert.ok(!('path' in artifacts[0]), 'list response should not expose filesystem paths');
    assert.ok(!JSON.stringify(artifacts[0]).includes('should-not-leak'));
    assert.ok(artifacts[0].contentUrl.includes(`/api/artifacts/${artifact.id}/content`));

    res = await fetch(`${baseUrl}/artifacts/${artifact.id}`);
    assert.strictEqual(res.status, 200);
    const detail = await res.json();
    assert.strictEqual(detail.id, artifact.id);
    assert.ok(!('path' in detail), 'detail response should not expose filesystem paths');

    res = await fetch(`${baseUrl}/artifacts/${artifact.id}/content`);
    assert.strictEqual(res.status, 404, 'missing file should produce 404 instead of leaking path');

    res = await fetch(`${baseUrl}/runs/${run.id}/artifacts/report`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const report = await res.json();
    assert.strictEqual(report.type, 'markdown');
    assert.strictEqual(report.title, 'Pentest report');

    res = await fetch(`${baseUrl}/artifacts/${report.id}/content`);
    assert.strictEqual(res.status, 200);
    const reportText = await res.text();
    assert.ok(reportText.includes('PHANTOM Pentest Report'));

    res = await fetch(`${baseUrl}/runs/${run.id}/graph`);
    assert.strictEqual(res.status, 200);
    const graph = await res.json();
    assert.strictEqual(graph.runId, run.id);
    assert.ok(graph.nodes.some(node => node.type === 'run'));
    assert.ok(graph.nodes.some(node => node.type === 'tool' && node.label === 'execute_command'));
    assert.ok(graph.nodes.some(node => node.type === 'artifact' && node.refId === artifact.id));
    assert.ok(graph.nodes.some(node => node.type === 'host' && node.label === '10.0.0.5'));
    assert.ok(graph.nodes.some(node => node.type === 'url' && node.label === 'https://api.example.com/login'));
    assert.ok(graph.edges.some(edge => edge.type === 'observed'));

    res = await fetch(`${baseUrl}/runs/${run.id}/artifacts/graph`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const graphArtifact = await res.json();
    assert.strictEqual(graphArtifact.type, 'json');
    assert.strictEqual(graphArtifact.title, 'Graph snapshot');

    res = await fetch(`${baseUrl}/artifacts/${graphArtifact.id}/content`);
    assert.strictEqual(res.status, 200);
    const graphSnapshot = await res.json();
    assert.strictEqual(graphSnapshot.runId, run.id);
    assert.ok(graphSnapshot.nodes.length >= graph.nodes.length);
  });
});
