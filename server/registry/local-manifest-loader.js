// Local manifest loader (B1 slice).
//
// Reads every *.manifest.json under server/registry/fixtures/, runs
// each through the v1 validator, and exposes the verified manifests
// + parity probes for the existing toolpack registry.
//
// This is the read-only slice of B1 — enough to:
//   - Power a `GET /api/registry/local` browse endpoint.
//   - Diff a manifest's declared install plan against the JS registry's
//     install plan during the parity-mode transition.
//   - Surface manifest count + per-pack validation status to the
//     diagnostics endpoint.
//
// Write paths (import/enable/install/rollback) land in subsequent
// B1/B2 commits.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { validateManifest } from './manifest-validator.js';
import { verifyManifestSignature } from './manifest-signer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, 'fixtures');

let _cache = null;
let _trustRoots = []; // { keyId, base64Key } — configured via setTrustRoots()

function readAndDigest(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const digest = 'sha256:' + crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, digest };
}

/**
 * Configure the trust roots used for signature verification. Each
 * root is `{ keyId, base64Key }` where keyId matches the manifest's
 * trust.signed_by label. Empty = no signature verification possible
 * (every manifest reports signature_status='unsigned').
 *
 * B3 will populate this from the registry_sources table; for now it's
 * caller-driven so tests can stand up their own keys.
 */
export function setTrustRoots(roots = []) {
  _trustRoots = Array.isArray(roots) ? roots.slice() : [];
  _cache = null; // re-load so signature_state is recomputed
}

/**
 * Determine the signature state of a single manifest given the
 * current trust roots. Returns one of:
 *   'unsigned' — no trust.signature, OR it's a placeholder digest
 *                (zero-prefixed) typical of fixtures
 *   'verified' — signature matches a known trust root
 *   'unknown_signer' — signature present + valid format, but signed_by
 *                does NOT match any configured trust root
 *   'invalid' — signature fails verification against the named root
 */
function assessSignature(raw, manifest) {
  const trust = manifest?.trust || {};
  if (!trust.signature || /^sha256:0+$/i.test(trust.digest || '')) {
    return { status: 'unsigned', detail: 'no signature or placeholder digest' };
  }
  if (!_trustRoots.length) {
    return { status: 'unknown_signer', detail: 'signature present but no trust roots configured' };
  }
  const root = _trustRoots.find((r) => r.keyId === trust.signed_by);
  if (!root) {
    return { status: 'unknown_signer', detail: `signed_by=${trust.signed_by} not in trust roots` };
  }
  const result = verifyManifestSignature({
    manifestBytes: raw,
    manifest,
    trustRootBase64: root.base64Key,
    expectedSigner: trust.signed_by,
  });
  if (result.ok) return { status: 'verified', detail: `signed by ${trust.signed_by}` };
  return { status: 'invalid', detail: result.errors.map((e) => `${e.path}: ${e.message}`).join('; ') };
}

/**
 * Walk the fixtures dir + validate each manifest. Caches the result —
 * call _resetCache() between tests if you mutate fixtures on disk.
 *
 * @returns {Array<{id, version, valid, errors: [], manifest, digest, computedDigest, source: 'fixture'}>}
 */
export function loadLocalManifests() {
  if (_cache) return _cache;
  if (!fs.existsSync(FIXTURES_DIR)) {
    _cache = [];
    return _cache;
  }
  const entries = fs.readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.manifest.json'));

  const results = [];
  for (const name of entries) {
    const fullPath = path.join(FIXTURES_DIR, name);
    let manifest = null;
    let parseError = null;
    let digest = null;
    let computedDigest = null;
    try {
      const { raw, digest: hashed } = readAndDigest(fullPath);
      computedDigest = hashed;
      manifest = JSON.parse(raw);
      digest = manifest?.trust?.digest || null;
    } catch (err) {
      parseError = err.message;
    }

    if (parseError) {
      results.push({
        id: name.replace('.manifest.json', ''),
        version: null,
        valid: false,
        errors: [{ path: '/', message: `parse error: ${parseError}` }],
        manifest: null,
        digest: null,
        computedDigest: null,
        source: 'fixture',
        path: fullPath,
      });
      continue;
    }

    const { ok, errors } = validateManifest(manifest);
    let signatureStatus = { status: 'unsigned', detail: 'manifest invalid; signature not checked' };
    try {
      const rawStr = fs.readFileSync(fullPath, 'utf8');
      signatureStatus = assessSignature(rawStr, manifest);
    } catch { /* fall through with default */ }
    results.push({
      id: manifest.identity?.id || name.replace('.manifest.json', ''),
      version: manifest.identity?.version || null,
      valid: ok,
      errors,
      manifest,
      digest,
      computedDigest,
      signatureStatus,
      source: 'fixture',
      path: fullPath,
    });
  }
  _cache = results;
  return _cache;
}

/** Get a single manifest record by id (returns null if not present). */
export function getLocalManifest(id) {
  return loadLocalManifests().find((m) => m.id === id) || null;
}

/** Roll-up for /api/diagnostics + the registry browse UI. */
export function getLocalManifestSummary() {
  const all = loadLocalManifests();
  const sigCounts = { verified: 0, unsigned: 0, unknown_signer: 0, invalid: 0 };
  for (const m of all) {
    const s = m.signatureStatus?.status || 'unsigned';
    if (s in sigCounts) sigCounts[s] += 1;
  }
  return {
    total: all.length,
    valid: all.filter((m) => m.valid).length,
    invalid: all.filter((m) => !m.valid).length,
    invalidIds: all.filter((m) => !m.valid).map((m) => m.id),
    signatures: sigCounts,
  };
}

/** Test-only — clear the cache so fixture mutations are picked up. */
export function _resetCache() { _cache = null; }
