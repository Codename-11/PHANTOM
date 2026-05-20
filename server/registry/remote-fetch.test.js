import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { fetchIndex, fetchManifest, fetchRevocations } from './remote-fetch.js';

function freshEd25519() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const raw = spkiDer.subarray(spkiDer.length - 32);
  return { privateKey, rawBase64: Buffer.from(raw).toString('base64') };
}

function digestOf(buf) {
  return 'sha256:' + createHash('sha256').update(buf).digest('hex');
}

// Stub HTTP fetcher — returns canned responses by URL.
function stubFetcher(responses) {
  return async (url) => {
    const r = responses[url];
    if (!r) {
      return { ok: false, status: 404, async arrayBuffer() { return Buffer.from(''); } };
    }
    if (r.throw) throw new Error(r.throw);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      async arrayBuffer() {
        return r.body instanceof Buffer ? r.body : Buffer.from(String(r.body || ''), 'utf8');
      },
    };
  };
}

describe('remote-fetch (B3-full)', () => {
  test('fetchIndex: refuses a disabled source', async () => {
    const src = { url: 'https://x.com', enabled: false };
    const r = await fetchIndex(src);
    assert.strictEqual(r.ok, false);
    assert.match(r.errors[0].message, /disabled/);
  });

  test('fetchIndex: returns parsed JSON for an unsigned-OK source', async () => {
    const indexBody = Buffer.from(JSON.stringify({ schema: 'registry/v1', packages: [] }), 'utf8');
    const fetcher = stubFetcher({ 'https://r.example/index.json': { status: 200, body: indexBody } });
    const src = { url: 'https://r.example', enabled: true, signing_key: null };
    const r = await fetchIndex(src, { fetcher });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.parsed.schema, 'registry/v1');
    assert.strictEqual(r.signatureStatus.status, 'unsigned');
  });

  test('fetchIndex: 5xx → ok=false with HTTP status in error', async () => {
    const fetcher = stubFetcher({ 'https://r.example/index.json': { status: 503 } });
    const src = { url: 'https://r.example', enabled: true };
    const r = await fetchIndex(src, { fetcher });
    assert.strictEqual(r.ok, false);
    assert.match(r.errors[0].message, /HTTP 503/);
  });

  test('fetchIndex: verifies signature when key pinned', async () => {
    const { privateKey, rawBase64 } = freshEd25519();
    const indexBody = Buffer.from(JSON.stringify({ schema: 'registry/v1' }), 'utf8');
    const digest = digestOf(indexBody);
    const sig = sign(null, Buffer.from(digest), privateKey).toString('base64');
    const fetcher = stubFetcher({
      'https://r.example/index.json':     { status: 200, body: indexBody },
      'https://r.example/index.json.sig': { status: 200, body: sig },
    });
    const src = { url: 'https://r.example', enabled: true, signing_key: rawBase64, signing_key_id: 'phantom' };
    const r = await fetchIndex(src, { fetcher });
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.strictEqual(r.signatureStatus.status, 'verified');
  });

  test('fetchIndex: tampered body → signature invalid → ok=false', async () => {
    const { privateKey, rawBase64 } = freshEd25519();
    const correctBody = Buffer.from(JSON.stringify({ schema: 'registry/v1' }), 'utf8');
    const tamperedBody = Buffer.from(JSON.stringify({ schema: 'registry/v1', evil: true }), 'utf8');
    const sig = sign(null, Buffer.from(digestOf(correctBody)), privateKey).toString('base64');
    const fetcher = stubFetcher({
      'https://r.example/index.json':     { status: 200, body: tamperedBody },
      'https://r.example/index.json.sig': { status: 200, body: sig },
    });
    const src = { url: 'https://r.example', enabled: true, signing_key: rawBase64, signing_key_id: 'phantom' };
    const r = await fetchIndex(src, { fetcher });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.signatureStatus.status, 'invalid');
  });

  test('fetchManifest: schema gate rejects malformed remote manifest', async () => {
    const malformed = Buffer.from('{}', 'utf8');
    const fetcher = stubFetcher({
      'https://r.example/packages/x/1.0.0/manifest.json': { status: 200, body: malformed },
    });
    const src = { url: 'https://r.example', enabled: true };
    const r = await fetchManifest(src, 'x', '1.0.0', { fetcher });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.length >= 1);
  });

  test('fetchRevocations: 404 → ok with empty feed (no revocations yet)', async () => {
    const fetcher = stubFetcher({}); // 404 for everything
    const src = { url: 'https://r.example', enabled: true };
    const r = await fetchRevocations(src, { fetcher });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.parsed.entries.length, 0);
  });

  test('timeout: abort surfaces as ok=false with timeout error', async () => {
    // Stub fetcher that hangs forever
    const fetcher = (_url, { signal }) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
    const src = { url: 'https://r.example', enabled: true };
    const r = await fetchIndex(src, { fetcher, timeoutMs: 50 });
    assert.strictEqual(r.ok, false);
    assert.match(r.errors[0].message, /timeout/);
  });
});
