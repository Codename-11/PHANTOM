// End-to-end smoke for the executor → run → trace store → synthesis pipe.
//
// Drives processMessage against a scripted fake OpenAI provider so the
// full agent loop runs against real persistence (`:memory:` SQLite, real
// Express, real trace events). Asserts the surfaces an operator actually
// looks at:
//   1. Trace events accumulate with the expected types
//   2. The run terminates as "completed"
//   3. /api/runs/:id/synthesis returns a valid v1 shape
//   4. The synthesis posture is non-null and counted activity matches
//
// Catches regressions in: the agent loop (one-and-done bug), executor
// dispatch, trace persistence, the run completion path, and the
// synthesis builder's downstream consumption of trace events.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import config, { updateConfig } from '../config.js';
import {
  initDB, closeDB,
  createConversation, createRun, addTraceEvent, completeRun, updateRunStatus,
} from '../memory/store.js';
import { processMessage, resetClient } from '../ai/llm-client.js';
import apiRouter from '../routes/api.js';

// Scripted fake OpenAI server. Keyed on user-message content so different
// E2E scenarios can route different completion sequences through the same
// process. Each script is a list of completion steps emitted in order on
// successive calls.
function startScriptedServer(scripts) {
  const callCount = new Map();
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end(); return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const payload = JSON.parse(body);
      const scenario = payload.messages?.find(m => m.role === 'user')?.content || 'default';
      const idx = callCount.get(scenario) || 0;
      callCount.set(scenario, idx + 1);
      const script = scripts.get(scenario) || [{ content: 'fallback', finishReason: 'stop' }];
      const step = script[Math.min(idx, script.length - 1)];

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      if (step.content) {
        res.write(`data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: step.content }, finish_reason: null }],
        })}\n\n`);
      }
      step.toolCalls?.forEach((tc, i) => {
        res.write(`data: ${JSON.stringify({
          choices: [{
            index: 0,
            delta: { tool_calls: [{
              index: i, id: `call_${idx}_${i}`, type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
            }] },
            finish_reason: null,
          }],
        })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: step.finishReason || 'stop' }],
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, callCount });
    });
  });
}

describe('E2E · full run → trace → synthesis pipe', () => {
  let fakeProvider;
  let apiServer;
  let apiBaseUrl;
  let originalApi;

  before(async () => {
    initDB(':memory:');

    // Stand up the scripted fake LLM. Scenario `e2e-recon` makes the
    // model perform a recon-style multi-step run: recall_memory →
    // save_memory → text summary. Both tools are local + side-effect-
    // free so the test stays hermetic.
    const scripts = new Map([
      ['e2e-recon', [
        // Round 1: call recall_memory.
        { toolCalls: [{ name: 'recall_memory', args: { query: 'lab-targets' } }], finishReason: 'stop' },
        // Round 2: call save_memory.
        { toolCalls: [{ name: 'save_memory', args: { category: 'lab', key: 'finding', value: 'port 22 open' } }], finishReason: 'stop' },
        // Round 3: produce the final assistant reply (no tool calls).
        { content: 'Recon complete. Saved 1 observation to memory.', finishReason: 'stop' },
      ]],
    ]);
    fakeProvider = await startScriptedServer(scripts);

    originalApi = { ...config.api };
    updateConfig({ baseUrl: fakeProvider.baseUrl, apiKey: 'test', model: 'e2e-model' });
    resetClient();

    // Stand up the API router so we can hit /api/runs/:id/synthesis.
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    await new Promise((resolve) => {
      apiServer = app.listen(0, '127.0.0.1', () => {
        apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}/api`;
        resolve();
      });
    });
  });

  after(async () => {
    if (apiServer) await new Promise(r => apiServer.close(r));
    if (fakeProvider?.server) await new Promise(r => fakeProvider.server.close(r));
    updateConfig(originalApi);
    resetClient();
    closeDB();
  });

  test('drives a multi-step run from chat to synthesis and asserts the full shape', async () => {
    const conv = createConversation('E2E recon');
    const run = createRun({
      conversationId: conv.id,
      title: 'E2E recon',
      goal: 'e2e-recon',
      model: 'e2e-model',
      providerRoute: 'fake',
    });

    // Capture every trace event the executor + processMessage callbacks
    // would emit — mirrors what server/index.js does in the WS path. We
    // assert against these counts after the run.
    const traceEvents = [];
    const trace = (event) => {
      const persisted = addTraceEvent(run.id, event);
      traceEvents.push(persisted);
      return persisted;
    };

    trace({ type: 'run.started', phase: 'chat', status: 'started', outputPreview: 'e2e-recon' });

    await processMessage(
      conv.id,
      'e2e-recon',
      () => {}, // onChunk
      (toolCall) => {
        trace({
          type: 'tool.call.started', phase: 'tool', status: 'started',
          toolName: toolCall.name, input: toolCall.args,
          metadata: { toolCallId: toolCall.id },
        });
      },
      (toolResult) => {
        trace({
          type: 'tool.call.completed', phase: 'tool', status: 'completed',
          toolName: toolResult.name, outputPreview: String(toolResult.result || '').slice(0, 200),
          metadata: { toolCallId: toolResult.id },
        });
      },
      (err) => { assert.fail(`run errored: ${err}`); },
      () => {},
      null,
      () => {},
      {
        trace,
        runId: run.id,
        enforceScope: false, // skip scope gating for the smoke
      }
    );

    updateRunStatus(run.id, 'completed', { summary: 'e2e ok', endedAt: new Date().toISOString() });
    trace({ type: 'run.completed', phase: 'chat', status: 'completed', outputPreview: 'e2e ok' });

    // ── Assertion block ──────────────────────────────────────────────
    // 1. The scripted provider was called 3 times — proves the agent
    //    loop didn't one-and-done after the first tool call.
    assert.equal(fakeProvider.callCount.get('e2e-recon'), 3,
      'agent loop should call provider 3 times across the multi-step run');

    // 2. Trace store should contain at least: run.started, 2 tool.call.started,
    //    2 tool.call.completed, run.completed. Plus possibly chunks.
    const typeCounts = traceEvents.reduce((acc, ev) => {
      acc[ev.type] = (acc[ev.type] || 0) + 1;
      return acc;
    }, {});
    assert.ok(typeCounts['tool.call.started'] >= 2,  `expected ≥2 tool.call.started, got ${typeCounts['tool.call.started']}`);
    assert.ok(typeCounts['tool.call.completed'] >= 2, `expected ≥2 tool.call.completed, got ${typeCounts['tool.call.completed']}`);
    assert.equal(typeCounts['run.started'], 1);
    assert.equal(typeCounts['run.completed'], 1);

    // 3. Synthesis endpoint returns a valid v1 shape.
    const synthRes = await fetch(`${apiBaseUrl}/runs/${run.id}/synthesis`);
    assert.equal(synthRes.status, 200);
    const synthesis = await synthRes.json();
    assert.equal(synthesis.v, 1);
    assert.equal(synthesis.runId, run.id);
    assert.equal(synthesis.status, 'completed');
    assert.equal(typeof synthesis.posture.score, 'number');
    assert.ok(synthesis.posture.score >= 0 && synthesis.posture.score <= 100);
    assert.match(synthesis.posture.rating, /^(strong|fair|weak|unknown)$/);
    assert.ok(Array.isArray(synthesis.highlights) && synthesis.highlights.length > 0);
    assert.ok(Array.isArray(synthesis.nextSteps) && synthesis.nextSteps.length > 0);

    // 4. Activity counts come from trace events — verify the synthesis
    //    builder reads the trace store correctly.
    assert.ok(synthesis.activity.toolCalls.total >= 2, 'tool call count flows from trace events');
    assert.ok(synthesis.activity.toolCalls.succeeded >= 2, 'two tool calls completed successfully');
    assert.equal(synthesis.objectives.met, 'met', 'no failures → goal marked met');
  });

  test('synthesis stub preview still serves without any runs in the DB', async () => {
    const res = await fetch(`${apiBaseUrl}/runs/preview/synthesis?preview=stub`);
    assert.equal(res.status, 200);
    const stub = await res.json();
    assert.equal(stub.v, 1);
    assert.equal(stub.runId, 'preview-run');
  });

  test('runs list endpoint reflects the run we just executed', async () => {
    const res = await fetch(`${apiBaseUrl}/runs?limit=10`);
    assert.equal(res.status, 200);
    const runs = await res.json();
    assert.ok(Array.isArray(runs));
    assert.ok(runs.some(r => r.title === 'E2E recon'),
      'completed run should appear in /api/runs');
  });
});
