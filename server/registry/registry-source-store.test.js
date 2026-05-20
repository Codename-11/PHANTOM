import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB } from '../memory/store.js';
import {
  createRegistrySource, getRegistrySource, listRegistrySources,
  updateRegistrySource, deleteRegistrySource, recordFetchOutcome,
} from './registry-source-store.js';

describe('registry-source-store (B3-full)', () => {
  afterEach(() => closeDB());

  test('createRegistrySource: requires label + https url', () => {
    initDB(':memory:');
    assert.throws(() => createRegistrySource({ label: '', url: 'https://x.com' }), /label is required/);
    assert.throws(() => createRegistrySource({ label: 'X', url: '' }), /url is required/);
    assert.throws(() => createRegistrySource({ label: 'X', url: 'http://x.com' }), /must be https/);
  });

  test('createRegistrySource: persists with defaults (disabled, stable channel)', () => {
    initDB(':memory:');
    const s = createRegistrySource({ label: 'Test', url: 'https://registry.example/' });
    assert.ok(s.id);
    assert.strictEqual(s.label, 'Test');
    assert.strictEqual(s.channel, 'stable');
    assert.strictEqual(s.enabled, false, 'sources land disabled by default');
    assert.strictEqual(s.signing_key, null);
  });

  test('createRegistrySource: rejects unknown channel', () => {
    initDB(':memory:');
    assert.throws(
      () => createRegistrySource({ label: 'X', url: 'https://x.com', channel: 'unstable' }),
      /channel must be one of/,
    );
  });

  test('listRegistrySources: returns all + enabledOnly filter', () => {
    initDB(':memory:');
    createRegistrySource({ label: 'A', url: 'https://a.com', enabled: true });
    createRegistrySource({ label: 'B', url: 'https://b.com', enabled: false });
    assert.strictEqual(listRegistrySources().length, 2);
    assert.strictEqual(listRegistrySources({ enabledOnly: true }).length, 1);
  });

  test('updateRegistrySource: merges fields; preserves signing_key when not provided', () => {
    initDB(':memory:');
    const s = createRegistrySource({
      label: 'X', url: 'https://x.com',
      signingKey: 'AAAA', signingKeyId: 'phantom',
    });
    const updated = updateRegistrySource(s.id, { label: 'X renamed' });
    assert.strictEqual(updated.label, 'X renamed');
    assert.strictEqual(updated.signing_key, 'AAAA');
    assert.strictEqual(updated.signing_key_id, 'phantom');
  });

  test('updateRegistrySource: enables / disables', () => {
    initDB(':memory:');
    const s = createRegistrySource({ label: 'X', url: 'https://x.com' });
    assert.strictEqual(s.enabled, false);
    const e = updateRegistrySource(s.id, { enabled: true });
    assert.strictEqual(e.enabled, true);
    const d = updateRegistrySource(s.id, { enabled: false });
    assert.strictEqual(d.enabled, false);
  });

  test('updateRegistrySource: still enforces https on URL changes', () => {
    initDB(':memory:');
    const s = createRegistrySource({ label: 'X', url: 'https://x.com' });
    assert.throws(() => updateRegistrySource(s.id, { url: 'http://insecure.com' }), /must be https/);
  });

  test('deleteRegistrySource: removes the row', () => {
    initDB(':memory:');
    const s = createRegistrySource({ label: 'X', url: 'https://x.com' });
    assert.strictEqual(deleteRegistrySource(s.id), true);
    assert.strictEqual(getRegistrySource(s.id), null);
  });

  test('recordFetchOutcome: records ok status, clears prior error', () => {
    initDB(':memory:');
    const s = createRegistrySource({ label: 'X', url: 'https://x.com' });
    recordFetchOutcome(s.id, { status: 'unreachable', error: 'DNS' });
    let updated = getRegistrySource(s.id);
    assert.strictEqual(updated.last_status, 'unreachable');
    assert.strictEqual(updated.last_error, 'DNS');
    recordFetchOutcome(s.id, { status: 'ok' });
    updated = getRegistrySource(s.id);
    assert.strictEqual(updated.last_status, 'ok');
    assert.strictEqual(updated.last_error, null);
  });

  test('recordFetchOutcome: rejects unknown status', () => {
    initDB(':memory:');
    const s = createRegistrySource({ label: 'X', url: 'https://x.com' });
    assert.throws(() => recordFetchOutcome(s.id, { status: 'banana' }), /unknown status/);
  });
});
