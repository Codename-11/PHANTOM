import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB } from '../memory/store.js';
import { createScope } from '../scope/scope-store.js';
import { createAsset } from '../assets/asset-store.js';
import { getOnboardingChecklist } from './onboarding-status.js';
import { runSeed, clearDemo } from '../../scripts/seed.js';

describe('onboarding status', () => {
  afterEach(() => closeDB());

  test('fresh DB: all four booleans false except possibly toolpacksInstalled (host-dependent)', () => {
    initDB(':memory:');
    const { checklist, complete } = getOnboardingChecklist();
    assert.strictEqual(checklist.hasAsset, false);
    assert.strictEqual(checklist.hasScope, false);
    assert.strictEqual(checklist.hasRun, false);
    assert.strictEqual(checklist.demoLoaded, false);
    assert.strictEqual(complete, false);
  });

  test('creating a scope flips hasScope', () => {
    initDB(':memory:');
    createScope({ name: 'Test', targets: { hosts: ['x'] }, allowedActions: ['recon'] });
    const { checklist } = getOnboardingChecklist();
    assert.strictEqual(checklist.hasScope, true);
  });

  test('creating an asset flips hasAsset', () => {
    initDB(':memory:');
    createAsset({ name: 'a', type: 'host' });
    const { checklist } = getOnboardingChecklist();
    assert.strictEqual(checklist.hasAsset, true);
  });

  test('runSeed flips hasScope + hasAsset + hasRun + demoLoaded', () => {
    initDB(':memory:');
    runSeed({});
    const { checklist } = getOnboardingChecklist();
    assert.strictEqual(checklist.hasScope, true);
    assert.strictEqual(checklist.hasAsset, true);
    assert.strictEqual(checklist.hasRun, true);
    assert.strictEqual(checklist.demoLoaded, true);
  });

  test('runSeed is idempotent: second call without reset throws', () => {
    initDB(':memory:');
    runSeed({});
    assert.throws(() => runSeed({}), /already present/i);
  });

  test('runSeed with reset wipes existing demo data first', () => {
    initDB(':memory:');
    runSeed({});
    // No throw on second run with reset
    const result = runSeed({ reset: true });
    assert.ok(result.cleared, 'cleared map should be populated');
  });

  test('clearDemo: standalone call removes demo rows', () => {
    initDB(':memory:');
    runSeed({});
    clearDemo();
    const { checklist } = getOnboardingChecklist();
    assert.strictEqual(checklist.demoLoaded, false);
  });
});
