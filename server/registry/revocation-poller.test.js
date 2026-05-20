import { describe, test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB } from '../memory/store.js';
import { createRegistrySource } from './registry-source-store.js';
import {
  pollOnce, checkRevoked, getRevocationSummary, listCachedRevocations,
  startRevocationPoller, stopRevocationPoller, _resetCache,
} from './revocation-poller.js';

describe('revocation-poller (B4-full)', () => {
  beforeEach(() => { _resetCache(); });
  afterEach(() => { stopRevocationPoller(); closeDB(); });

  test('checkRevoked: returns ok when cache is empty', () => {
    assert.deepEqual(checkRevoked('web-recon', '1.0.0'), { status: 'ok' });
  });

  test('getRevocationSummary: zeroes when cache is empty', () => {
    const s = getRevocationSummary();
    assert.deepEqual(s, { sources: 0, entries: 0, warn: 0, block: 0 });
  });

  test('pollOnce: gracefully handles disabled sources (skips them)', async () => {
    initDB(':memory:');
    createRegistrySource({ label: 'X', url: 'https://x.example', enabled: false });
    const results = await pollOnce();
    assert.strictEqual(results.length, 0, 'disabled sources should not be polled');
  });

  test('startRevocationPoller: is idempotent', () => {
    initDB(':memory:');
    startRevocationPoller({ intervalMs: 60000 });
    startRevocationPoller({ intervalMs: 60000 }); // second call no-op
    stopRevocationPoller();
  });

  test('listCachedRevocations: empty list when no sources polled', () => {
    assert.deepEqual(listCachedRevocations(), []);
  });
});
