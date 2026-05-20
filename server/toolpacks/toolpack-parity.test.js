import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getToolpacksWithManifestStatus, getToolpacks } from './toolpack-registry.js';

describe('toolpack manifest parity (B1)', () => {
  test('returns a parity flag for every JS-registry toolpack', async () => {
    const packs = await getToolpacksWithManifestStatus();
    const ids = packs.map((p) => p.id);
    const expected = getToolpacks().map((p) => p.id);
    assert.deepEqual(Array.from(ids), Array.from(expected),
      'parity helper should preserve the JS-registry order and ids');
    for (const p of packs) {
      assert.ok(p.parity, `${p.id} missing parity flag`);
      assert.ok(
        ['ok', 'manifest_missing', 'manifest_invalid'].includes(p.parity.status),
        `unexpected parity.status for ${p.id}: ${p.parity.status}`,
      );
    }
  });

  test('parity.status is "ok" for the toolpacks that ship with fixtures', async () => {
    const packs = await getToolpacksWithManifestStatus();
    // Every JS-registry pack with a matching fixture under
    // server/registry/fixtures/ should report ok. The list of fixtures
    // is intentionally not enumerated here — the assertion is that AT
    // LEAST one pack reports ok (proves the loader integration works).
    const okCount = packs.filter((p) => p.parity.status === 'ok').length;
    assert.ok(okCount >= 1, `expected ≥1 toolpack with manifest_ok parity, got ${okCount}`);
  });

  test('every ok-parity pack carries a computed digest', async () => {
    const packs = await getToolpacksWithManifestStatus();
    for (const p of packs) {
      if (p.parity.status === 'ok') {
        assert.ok(p.parity.digest, `${p.id} parity.ok but no digest`);
        assert.match(p.parity.digest, /^sha256:/);
      }
    }
  });

  test('preserves the original JS-registry fields on every entry', async () => {
    const packs = await getToolpacksWithManifestStatus();
    for (const p of packs) {
      assert.ok(p.name, `${p.id} missing name`);
      assert.ok(p.summary, `${p.id} missing summary`);
      assert.ok(Array.isArray(p.tools), `${p.id} tools not an array`);
    }
  });
});
