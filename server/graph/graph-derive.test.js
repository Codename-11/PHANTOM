import { test, describe } from 'node:test';
import assert from 'node:assert';
import { deriveRunGraph } from './graph-derive.js';

describe('Graph derivation', () => {
  test('deriveRunGraph builds execution and observation nodes from run telemetry', () => {
    const run = {
      id: 'run-1',
      title: 'Graph test run',
      goal: 'Inspect http://example.com:8080 and 10.0.0.5:22',
      status: 'completed',
      model: 'grok-4.3',
      provider_route: 'hermes-proxy',
      started_at: '2026-05-17T17:00:00.000Z',
      ended_at: '2026-05-17T17:01:00.000Z',
    };
    const events = [
      {
        id: 'evt-start',
        run_id: run.id,
        seq: 1,
        type: 'run.started',
        status: 'started',
        output_preview: 'Inspect http://example.com:8080 and 10.0.0.5:22',
      },
      {
        id: 'evt-tool-start',
        run_id: run.id,
        seq: 2,
        type: 'tool.call.started',
        status: 'started',
        tool_name: 'execute_command',
        input: { command: 'curl http://example.com:8080/status && nc -vz 10.0.0.5 22' },
        metadata: { toolCallId: 'call-1' },
      },
      {
        id: 'evt-tool-complete',
        run_id: run.id,
        seq: 3,
        type: 'tool.call.completed',
        status: 'completed',
        tool_name: 'execute_command',
        output_preview: 'Connected to 10.0.0.5:22; https://api.example.com/login open; 192.168.1.10:443',
        metadata: { toolCallId: 'call-1' },
      },
    ];
    const artifacts = [
      {
        id: 'artifact-1',
        run_id: run.id,
        type: 'html',
        title: 'Preview Window',
        mime_type: 'text/html',
        metadata: { traceEventId: 'evt-tool-complete' },
        contentUrl: '/api/artifacts/artifact-1/content',
      },
    ];

    const graph = deriveRunGraph({ run, events, artifacts });

    assert.strictEqual(graph.runId, run.id);
    assert.ok(graph.generatedAt, 'graph should include generation timestamp');
    assert.ok(graph.nodes.some(node => node.id === `run:${run.id}` && node.type === 'run'));
    assert.ok(graph.nodes.some(node => node.type === 'tool' && node.label === 'execute_command' && node.status === 'completed'));
    assert.ok(graph.nodes.some(node => node.type === 'artifact' && node.refId === 'artifact-1'));
    assert.ok(graph.nodes.some(node => node.type === 'url' && node.label === 'http://example.com:8080/status'));
    assert.ok(graph.nodes.some(node => node.type === 'host' && node.label === '10.0.0.5'));
    assert.ok(graph.nodes.some(node => node.type === 'port' && node.label === '22'));
    assert.ok(graph.nodes.some(node => node.type === 'host' && node.label === 'api.example.com'));
    assert.ok(graph.edges.some(edge => edge.type === 'called' && edge.source === `run:${run.id}`));
    assert.ok(graph.edges.some(edge => edge.type === 'generated' && edge.target === 'artifact:artifact-1'));
    assert.ok(graph.edges.some(edge => edge.type === 'observed' && edge.target.startsWith('host:10.0.0.5')));
  });
});
