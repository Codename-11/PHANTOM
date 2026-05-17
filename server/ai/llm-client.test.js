import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { processMessage, testConnection, resetClient } from './llm-client.js';
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
