import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLocalManifests, getLocalManifest, getLocalManifestSummary, _resetCache, setTrustRoots,
} from './local-manifest-loader.js';

describe('local-manifest-loader', () => {
  beforeEach(() => { setTrustRoots([]); _resetCache(); });

  test('loadLocalManifests: returns every fixture under server/registry/fixtures', () => {
    const all = loadLocalManifests();
    assert.ok(all.length >= 7, `expected ≥7 fixtures, got ${all.length}`);
    // Each result has the contract shape
    for (const m of all) {
      assert.ok(typeof m.id === 'string' && m.id.length > 0);
      assert.ok('valid' in m);
      assert.ok(Array.isArray(m.errors));
      assert.strictEqual(m.source, 'fixture');
      assert.ok(m.computedDigest && m.computedDigest.startsWith('sha256:'));
    }
  });

  test('every fixture validates against the v1 schema', () => {
    const all = loadLocalManifests();
    const invalid = all.filter((m) => !m.valid);
    assert.deepEqual(invalid, [],
      `${invalid.length} fixture(s) failed validation: ${invalid.map((m) => `${m.id}: ${JSON.stringify(m.errors)}`).join('\n')}`);
  });

  test('getLocalManifest: lookup by id', () => {
    const m = getLocalManifest('web-recon');
    assert.ok(m, 'expected web-recon fixture');
    assert.strictEqual(m.id, 'web-recon');
    assert.strictEqual(m.manifest.identity.id, 'web-recon');
  });

  test('getLocalManifest: returns null for unknown id', () => {
    assert.strictEqual(getLocalManifest('does-not-exist'), null);
  });

  test('getLocalManifestSummary: rolls up totals', () => {
    const s = getLocalManifestSummary();
    assert.ok(s.total >= 7);
    assert.strictEqual(s.valid, s.total);
    assert.strictEqual(s.invalid, 0);
    assert.deepEqual(s.invalidIds, []);
  });

  test('result is cached across calls within a session', () => {
    const a = loadLocalManifests();
    const b = loadLocalManifests();
    assert.strictEqual(a, b, 'should be the same cached array');
  });

  test('_resetCache clears the cache', () => {
    const a = loadLocalManifests();
    _resetCache();
    const b = loadLocalManifests();
    assert.notStrictEqual(a, b, 'after reset, expect a fresh array');
  });

  // B3 prep — signature status assessment per manifest.
  test('signatureStatus: fixtures with placeholder digests report "unsigned"', () => {
    const all = loadLocalManifests();
    for (const m of all) {
      assert.ok(m.signatureStatus, `${m.id} missing signatureStatus`);
      assert.ok(
        ['unsigned', 'unknown_signer', 'verified', 'invalid'].includes(m.signatureStatus.status),
        `${m.id} bad signatureStatus.status: ${m.signatureStatus.status}`,
      );
    }
  });

  test('getLocalManifestSummary: surfaces signature counts', () => {
    const s = getLocalManifestSummary();
    assert.ok(s.signatures, 'summary should expose .signatures');
    assert.strictEqual(typeof s.signatures.unsigned, 'number');
    assert.strictEqual(typeof s.signatures.verified, 'number');
    // Default fixtures use placeholder digests, so they're unsigned.
    assert.ok(s.signatures.unsigned >= 1);
  });

  test('setTrustRoots: configurable; empty roots → fixtures report unsigned', () => {
    setTrustRoots([]);
    _resetCache();
    const all = loadLocalManifests();
    // All fixtures have placeholder digests → unsigned regardless of roots.
    const sigStates = new Set(all.map((m) => m.signatureStatus.status));
    assert.ok(sigStates.has('unsigned'));
  });
});
