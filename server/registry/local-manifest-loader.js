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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, 'fixtures');

let _cache = null;

function readAndDigest(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const digest = 'sha256:' + crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, digest };
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
    results.push({
      id: manifest.identity?.id || name.replace('.manifest.json', ''),
      version: manifest.identity?.version || null,
      valid: ok,
      errors,
      manifest,
      digest,
      computedDigest,
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
  return {
    total: all.length,
    valid: all.filter((m) => m.valid).length,
    invalid: all.filter((m) => !m.valid).length,
    invalidIds: all.filter((m) => !m.valid).map((m) => m.id),
  };
}

/** Test-only — clear the cache so fixture mutations are picked up. */
export function _resetCache() { _cache = null; }
