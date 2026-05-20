// Remote-fetch + verify for hosted registry sources (B3-full).
//
// Wires the B3-prep ed25519 verifier into a real HTTP fetcher with
// timeout + signature check + outcome bookkeeping via the source store.
//
// Three flows:
//   - fetchIndex(source)    → GET <source.url>/index.json + verify
//   - fetchManifest(source, packageId, version) → manifest fetch
//   - fetchRevocations(source) → revocation feed fetch (B4 client)
//
// All flows return { ok, content, parsed?, errors[] }. Network errors,
// non-2xx, signature failures, schema failures, digest mismatches —
// every failure path resolves with ok=false + a structured error list.
// Callers can persist the outcome via recordFetchOutcome().
//
// The HTTP client is injectable via opts.fetcher so tests can stub
// without a live server. Default uses node:undici via global fetch
// (Node 18+).

import { createHash } from 'node:crypto';
import { verifyManifestSignature } from './manifest-signer.js';
import { parseRevocationFeed } from './revocation-feed.js';
import { validateManifest } from './manifest-validator.js';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB ceiling for any single fetch

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}

async function httpGet(url, { fetcher = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetcher !== 'function') {
    throw new Error('no fetcher available (Node 18+ required, or pass opts.fetcher)');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      return { ok: false, status: res.status, error: `body exceeds ${MAX_BODY_BYTES} bytes` };
    }
    return { ok: true, status: res.status, body: Buffer.from(buf) };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { ok: false, status: 0, error: `timeout after ${timeoutMs}ms` };
    return { ok: false, status: 0, error: err.message || String(err) };
  }
}

/**
 * Fetch a source's index.json + optional .sig + verify against the
 * source's pinned signing key. Returns the parsed index when signature
 * verification passes.
 */
export async function fetchIndex(source, opts = {}) {
  if (!source || !source.url) return { ok: false, errors: [{ path: '$', message: 'missing source' }] };
  if (!source.enabled) return { ok: false, errors: [{ path: 'source', message: 'source is disabled' }] };

  const indexUrl = joinUrl(source.url, 'index.json');
  const sigUrl = joinUrl(source.url, 'index.json.sig');

  const [indexRes, sigRes] = await Promise.all([
    httpGet(indexUrl, opts),
    source.signing_key ? httpGet(sigUrl, opts) : Promise.resolve({ ok: false, status: 0, error: 'no signing key configured' }),
  ]);

  if (!indexRes.ok) {
    return { ok: false, errors: [{ path: 'index', message: indexRes.error }] };
  }

  // Optional signature verification — only when a signing key is pinned.
  let signatureStatus = { status: 'unsigned', detail: 'no signing key configured for this source' };
  if (source.signing_key) {
    if (!sigRes.ok) {
      return {
        ok: false,
        errors: [{ path: 'index.sig', message: `signature fetch failed: ${sigRes.error}` }],
        signatureStatus: { status: 'invalid', detail: sigRes.error },
      };
    }
    const sigBase64 = sigRes.body.toString('utf8').trim();
    const result = verifyManifestSignature({
      manifestBytes: indexRes.body,
      manifest: { trust: { digest: computeBodyDigest(indexRes.body), signature: sigBase64, signed_by: source.signing_key_id || 'phantom' } },
      trustRootBase64: source.signing_key,
      expectedSigner: source.signing_key_id || null,
    });
    if (!result.ok) {
      return {
        ok: false,
        errors: result.errors,
        signatureStatus: { status: 'invalid', detail: result.errors.map((e) => e.message).join('; ') },
      };
    }
    signatureStatus = { status: 'verified', detail: `signed by ${source.signing_key_id || 'phantom'}` };
  }

  let parsed;
  try { parsed = JSON.parse(indexRes.body.toString('utf8')); }
  catch (err) { return { ok: false, errors: [{ path: 'index', message: `JSON parse failed: ${err.message}` }] }; }

  return { ok: true, parsed, signatureStatus, errors: [] };
}

/**
 * Fetch a single manifest (package + version) from a source.
 * Verifies signature using the same trust root as the index.
 */
export async function fetchManifest(source, packageId, version, opts = {}) {
  if (!source || !source.url) return { ok: false, errors: [{ path: '$', message: 'missing source' }] };
  if (!source.enabled) return { ok: false, errors: [{ path: 'source', message: 'source is disabled' }] };

  const manifestUrl = joinUrl(source.url, `packages/${packageId}/${version}/manifest.json`);
  const sigUrl = joinUrl(source.url, `packages/${packageId}/${version}/manifest.json.sig`);

  const [mRes, sRes] = await Promise.all([
    httpGet(manifestUrl, opts),
    source.signing_key ? httpGet(sigUrl, opts) : Promise.resolve({ ok: false, error: 'no signing key' }),
  ]);

  if (!mRes.ok) return { ok: false, errors: [{ path: 'manifest', message: mRes.error }] };

  let manifest;
  try { manifest = JSON.parse(mRes.body.toString('utf8')); }
  catch (err) { return { ok: false, errors: [{ path: 'manifest', message: `JSON parse failed: ${err.message}` }] }; }

  // Schema gate first — reject malformed manifests before considering them.
  const schema = validateManifest(manifest);
  if (!schema.ok) {
    return { ok: false, errors: schema.errors, signatureStatus: { status: 'invalid', detail: 'schema validation failed' } };
  }

  // Signature gate (when key pinned).
  let signatureStatus = { status: 'unsigned', detail: 'no signing key configured' };
  if (source.signing_key) {
    if (!sRes.ok) {
      return { ok: false, errors: [{ path: 'manifest.sig', message: sRes.error }] };
    }
    const sigBase64 = sRes.body.toString('utf8').trim();
    // Manifest already has its own trust block — overlay the fetched sig
    // for verification.
    const withSig = { ...manifest, trust: { ...(manifest.trust || {}), signature: sigBase64, signed_by: source.signing_key_id || (manifest.trust?.signed_by ?? 'phantom') } };
    const verify = verifyManifestSignature({
      manifestBytes: mRes.body,
      manifest: withSig,
      trustRootBase64: source.signing_key,
      expectedSigner: source.signing_key_id || null,
    });
    if (!verify.ok) {
      return { ok: false, errors: verify.errors, signatureStatus: { status: 'invalid', detail: verify.errors.map((e) => e.message).join('; ') } };
    }
    signatureStatus = { status: 'verified', detail: `signed by ${source.signing_key_id || 'phantom'}` };
  }

  return { ok: true, manifest, signatureStatus, errors: [] };
}

/**
 * Fetch + verify a source's revocations.json. Builds on B4-prep
 * parseRevocationFeed.
 */
export async function fetchRevocations(source, opts = {}) {
  if (!source || !source.url) return { ok: false, errors: [{ path: '$', message: 'missing source' }] };
  if (!source.enabled) return { ok: false, errors: [{ path: 'source', message: 'source is disabled' }] };

  const feedUrl = joinUrl(source.url, 'revocations.json');
  const res = await httpGet(feedUrl, opts);
  if (!res.ok) {
    // 404 is normal — many sources don't publish revocations yet.
    if (res.status === 404) return { ok: true, parsed: { byPackage: new Map(), entries: [], generatedAt: null }, signatureStatus: { status: 'unsigned', detail: 'no revocation feed yet' }, errors: [] };
    return { ok: false, errors: [{ path: 'revocations', message: res.error }] };
  }

  return parseRevocationFeed(res.body.toString('utf8'), {
    trustRootBase64: source.signing_key || null,
    expectedSigner: source.signing_key_id || null,
  });
}

function computeBodyDigest(buf) {
  return 'sha256:' + createHash('sha256').update(buf).digest('hex');
}

export const _internals = { httpGet, joinUrl, DEFAULT_TIMEOUT_MS, MAX_BODY_BYTES };
