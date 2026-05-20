import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB } from '../memory/store.js';
import { getDiagnostics, _internals } from './diagnostics.js';

describe('diagnostics', () => {
  afterEach(() => closeDB());

  test('redactKey: short keys collapse to ••••, long keys keep last 4', () => {
    assert.strictEqual(_internals.redactKey(null), null);
    assert.strictEqual(_internals.redactKey(''), null);
    assert.strictEqual(_internals.redactKey('abc'), '••••');
    assert.strictEqual(_internals.redactKey('sk-foobarbaz1234'), '••••1234');
  });

  test('worstStatus: returns the highest-severity status', () => {
    assert.strictEqual(_internals.worstStatus(['ok', 'ok']), 'ok');
    assert.strictEqual(_internals.worstStatus(['ok', 'needs_setup']), 'needs_setup');
    assert.strictEqual(_internals.worstStatus(['needs_setup', 'degraded']), 'degraded');
    assert.strictEqual(_internals.worstStatus(['ok', 'degraded', 'blocked', 'ok']), 'blocked');
  });

  test('runCheck: timeout returns degraded with elapsedMs ≈ timeout', async () => {
    const result = await _internals.runCheck('slow', () => new Promise((r) => setTimeout(() => r({ status: 'ok' }), 5000)));
    assert.strictEqual(result.status, 'degraded');
    assert.match(result.detail, /timed out/);
    assert.ok(result.elapsedMs <= _internals.PER_CHECK_TIMEOUT_MS + 50);
  });

  test('runCheck: thrown error becomes blocked status', async () => {
    const result = await _internals.runCheck('boom', () => { throw new Error('explode'); });
    assert.strictEqual(result.status, 'blocked');
    assert.match(result.detail, /explode/);
  });

  test('getDiagnostics: returns overall + per-check shape within budget', async () => {
    initDB(':memory:');
    const started = Date.now();
    const result = await getDiagnostics();
    const elapsed = Date.now() - started;

    // Returns within total budget + slack for concurrent test scheduling.
    // Timing assertions under `node --test` parallelism can spike well
    // past the production budget (the assertion is here to catch
    // wholesale regressions like a 10s probe, not a 100ms drift).
    assert.ok(elapsed <= _internals.TOTAL_BUDGET_MS + 4500, `elapsed=${elapsed}`);
    // Shape
    assert.ok(['ok', 'needs_setup', 'degraded', 'blocked'].includes(result.overall));
    assert.ok(Array.isArray(result.checks));
    // All expected check ids present (or budget marker)
    const ids = new Set(result.checks.map((c) => c.id));
    const expected = ['runtime', 'db', 'workspace', 'provider', 'docs', 'toolpacks', 'campaigns', 'registry'];
    const hasAll = expected.every((id) => ids.has(id));
    const hasBudget = ids.has('__budget__');
    assert.ok(hasAll || hasBudget, `missing checks: ${expected.filter(e => !ids.has(e)).join(',')}`);
    assert.ok(result.generatedAt);
  });

  test('getDiagnostics: never returns raw secrets in provider check', async () => {
    initDB(':memory:');
    const result = await getDiagnostics();
    const provider = result.provider;
    if (provider?.hasApiKey) {
      // Preview is redacted form, not the raw key
      assert.match(provider.apiKeyPreview, /^••••/);
    }
    // No secret regex appears anywhere in the JSON serialization
    const json = JSON.stringify(result);
    assert.ok(!/sk-[a-zA-Z0-9]{20,}/.test(json), 'raw API key shape leaked');
    assert.ok(!/sudo_password/i.test(json) || /sudo_password_set/.test(json),
      'sudo_password key name should not appear unless prefixed safely');
  });

  test('getDiagnostics: fresh in-memory DB returns ok or needs_setup, never blocked', async () => {
    initDB(':memory:');
    const result = await getDiagnostics();
    assert.ok(['ok', 'needs_setup', 'degraded'].includes(result.overall),
      `unexpected overall=${result.overall}; details: ${JSON.stringify(result.checks, null, 2)}`);
  });
});
