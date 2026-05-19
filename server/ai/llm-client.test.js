import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { processMessage, testConnection, resetClient, MAX_AGENT_ITERATIONS } from './llm-client.js';
import config from '../config.js';
import { initDB, closeDB, createConversation } from '../memory/store.js';

function startFakeOpenAIServer() {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const payload = body ? JSON.parse(body) : {};
      const answer = payload.stream ? 'Test Passed' : 'PHANTOM online';

      if (payload.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: answer }, finish_reason: null }],
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: answer },
          finish_reason: 'stop',
        }],
      }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` });
    });
  });
}

describe('LLM Client Integration', () => {
  let fakeServer;

  before(async () => {
    initDB(':memory:');

    const fake = await startFakeOpenAIServer();
    fakeServer = fake.server;

    // Deterministic OpenAI-compatible endpoint. The live PHANTOM → Hermes proxy
    // path is covered by tests/smoke_test.py; unit tests should not spend real
    // provider quota or depend on external credentials.
    config.api.baseUrl = fake.baseUrl;
    config.api.apiKey = 'test-key-placeholder';
    config.api.model = 'grok-4.3';

    resetClient();
  });

  after(async () => {
    closeDB();
    if (fakeServer) {
      await new Promise((resolve) => fakeServer.close(resolve));
    }
  });

  test('testConnection should return success with local OpenAI-compatible server', async () => {
    const result = await testConnection();
    assert.strictEqual(result.success, true, `Connection failed: ${result.message}`);
    assert.ok(result.message);
    assert.match(result.message, /PHANTOM online/i);
  });

  test('processMessage should stream a response', async () => {
    const conv = createConversation('Test Conv');

    let fullResponse = '';

    await processMessage(
      conv.id,
      'Hello, just say "Test Passed" and nothing else.',
      (chunk) => { fullResponse += chunk; },
      () => {},
      () => {},
      (error) => { assert.fail(`LLM Error: ${error}`); },
      () => {},
      null,
      () => {}
    );

    assert.ok(fullResponse.length > 0, 'Should have received a response');
    assert.match(fullResponse, /Test Passed/i);
  });
});

// ── Stop-condition + multi-turn agent loop tests ─────────────────────────
// These use a separate fake server because they need scripted multi-turn
// completion sequences keyed on call index, not the simple echo server
// the integration test above uses.
function startScriptedServer(scripts) {
  // scripts: Map of "scenario name" → array of completion responses
  // (one per LLM call). Each response is { content, toolCalls, finishReason }
  // and we emit chunks accordingly.
  const callCount = new Map();
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const payload = JSON.parse(body);
      const scenario = payload.messages?.find(m => m.role === 'user')?.content || 'default';
      const idx = callCount.get(scenario) || 0;
      callCount.set(scenario, idx + 1);
      const script = scripts.get(scenario) || [{ content: 'no script', toolCalls: [], finishReason: 'stop' }];
      const step = script[Math.min(idx, script.length - 1)];

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      // Content first
      if (step.content) {
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-test', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: step.content }, finish_reason: null }],
        })}\n\n`);
      }
      // Tool calls — single chunk per call to mimic Grok's actual streaming
      step.toolCalls?.forEach((tc, i) => {
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-test', object: 'chat.completion.chunk',
          choices: [{
            index: 0,
            delta: { tool_calls: [{
              index: i, id: tc.id || `call_${idx}_${i}`, type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
            }] },
            finish_reason: null,
          }],
        })}\n\n`);
      });
      // Terminal chunk carrying the finish reason
      res.write(`data: ${JSON.stringify({
        id: 'chatcmpl-test', object: 'chat.completion.chunk',
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

describe('Agent loop · stop-condition tolerance', () => {
  let fake;
  let originalBaseUrl;

  before(async () => {
    initDB(':memory:');
    originalBaseUrl = config.api.baseUrl;
  });

  after(async () => {
    closeDB();
    if (fake?.server) await new Promise(r => fake.server.close(r));
    config.api.baseUrl = originalBaseUrl;
    resetClient();
  });

  test('executes tool_calls even when finish_reason is "stop" (Grok-style)', async () => {
    // Round 1: tool call paired with finish_reason='stop' (the bug).
    // Round 2: plain text → terminate.
    const scripts = new Map([
      ['grok-stop-bug', [
        { toolCalls: [{ name: 'recall_memory', args: { query: 'phantom' } }], finishReason: 'stop' },
        { content: 'Done.', finishReason: 'stop' },
      ]],
    ]);
    fake = await startScriptedServer(scripts);
    config.api.baseUrl = fake.baseUrl;
    config.api.apiKey = 'test';
    config.api.model = 'grok-test';
    resetClient();

    const conv = createConversation('grok-bug');
    let toolCallCount = 0;
    let finalContent = '';
    await processMessage(
      conv.id, 'grok-stop-bug',
      (c) => { finalContent += c; },
      () => { toolCallCount += 1; },
      () => {},
      (err) => { assert.fail(`Should not error: ${err}`); },
      () => {}, null, () => {},
    );
    assert.strictEqual(toolCallCount, 1, 'tool call must execute despite finish_reason=stop');
    assert.match(finalContent, /Done/);
    assert.strictEqual(fake.callCount.get('grok-stop-bug'), 2, 'two LLM rounds, not one');
    fake.server.close();
    fake = null;
  });

  test('continues across multiple tool-calling rounds', async () => {
    const scripts = new Map([
      ['multi-turn', [
        { toolCalls: [{ name: 'recall_memory', args: { query: 'a' } }], finishReason: 'tool_calls' },
        { toolCalls: [{ name: 'recall_memory', args: { query: 'b' } }], finishReason: 'tool_calls' },
        { toolCalls: [{ name: 'recall_memory', args: { query: 'c' } }], finishReason: 'stop' },
        { content: 'All three steps done.', finishReason: 'stop' },
      ]],
    ]);
    fake = await startScriptedServer(scripts);
    config.api.baseUrl = fake.baseUrl;
    resetClient();

    const conv = createConversation('multi-turn');
    let toolCallCount = 0;
    let finalContent = '';
    await processMessage(
      conv.id, 'multi-turn',
      (c) => { finalContent += c; },
      () => { toolCallCount += 1; },
      () => {},
      (err) => { assert.fail(`Should not error: ${err}`); },
      () => {}, null, () => {},
    );
    assert.strictEqual(toolCallCount, 3, 'three rounds of tool calls');
    assert.match(finalContent, /three steps done/i);
    fake.server.close();
    fake = null;
  });

  test('caps runaway loops at MAX_AGENT_ITERATIONS', async () => {
    // A model that always returns a tool call → would loop forever without the cap.
    const infinite = [];
    for (let i = 0; i < MAX_AGENT_ITERATIONS + 5; i++) {
      infinite.push({ toolCalls: [{ name: 'recall_memory', args: { query: `x${i}` } }], finishReason: 'stop' });
    }
    const scripts = new Map([['infinite', infinite]]);
    fake = await startScriptedServer(scripts);
    config.api.baseUrl = fake.baseUrl;
    resetClient();

    const conv = createConversation('infinite');
    let lastChunk = '';
    await processMessage(
      conv.id, 'infinite',
      (c) => { lastChunk += c; },
      () => {},
      () => {},
      (err) => { assert.fail(`Should not error: ${err}`); },
      () => {}, null, () => {},
    );
    assert.ok(fake.callCount.get('infinite') <= MAX_AGENT_ITERATIONS,
      `should stop at ${MAX_AGENT_ITERATIONS} iterations, got ${fake.callCount.get('infinite')}`);
    assert.match(lastChunk, /Stopped after \d+ tool rounds/);
    fake.server.close();
    fake = null;
  });

  test('empty completion exits cleanly instead of looping', async () => {
    const scripts = new Map([['empty', [
      { content: '', toolCalls: [], finishReason: 'stop' },
    ]]]);
    fake = await startScriptedServer(scripts);
    config.api.baseUrl = fake.baseUrl;
    resetClient();

    const conv = createConversation('empty');
    let finalContent = '';
    await processMessage(
      conv.id, 'empty',
      (c) => { finalContent += c; },
      () => {},
      () => {},
      (err) => { assert.fail(`Should not error: ${err}`); },
      () => {}, null, () => {},
    );
    assert.match(finalContent, /empty completion/i);
    assert.strictEqual(fake.callCount.get('empty'), 1, 'must not loop on empty response');
    fake.server.close();
    fake = null;
  });

  test('surfaces finish_reason=length as a friendly truncation hint', async () => {
    const scripts = new Map([['truncated', [
      { content: '', toolCalls: [], finishReason: 'length' },
    ]]]);
    fake = await startScriptedServer(scripts);
    config.api.baseUrl = fake.baseUrl;
    resetClient();

    const conv = createConversation('truncated');
    let finalContent = '';
    await processMessage(
      conv.id, 'truncated',
      (c) => { finalContent += c; },
      () => {},
      () => {},
      (err) => { assert.fail(`Should not error: ${err}`); },
      () => {}, null, () => {},
    );
    assert.match(finalContent, /max_tokens|truncated/i);
    fake.server.close();
    fake = null;
  });
});
