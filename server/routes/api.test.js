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

    res = await fetch(`${baseUrl}/prompts/preview`);
    assert.strictEqual(res.status, 200);
    const prompt = await res.json();
    assert.ok(prompt.content.includes('You are PHANTOM'));
    assert.ok(!JSON.stringify(prompt).includes('sudo_password'));
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
