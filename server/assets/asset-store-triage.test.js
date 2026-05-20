import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB } from '../memory/store.js';
import { createAsset, createFinding, getFinding, setFindingTriage, isHighSeverity } from './asset-store.js';

describe('finding triage (A7)', () => {
  afterEach(() => closeDB());

  test('new finding has triage_status defaulted to "new"', () => {
    initDB(':memory:');
    const a = createAsset({ name: 'h', type: 'host' });
    const f = createFinding({ assetId: a.id, title: 'x', severity: 'low' });
    assert.strictEqual(f.triage_status, 'new');
    assert.strictEqual(f.dismissal_note, null);
  });

  test('setFindingTriage: walks the lifecycle', () => {
    initDB(':memory:');
    const a = createAsset({ name: 'h', type: 'host' });
    const f = createFinding({ assetId: a.id, title: 'x', severity: 'low' });
    const ack = setFindingTriage(f.id, { triageStatus: 'acknowledged' });
    assert.strictEqual(ack.triage_status, 'acknowledged');
    const wip = setFindingTriage(f.id, { triageStatus: 'in_progress' });
    assert.strictEqual(wip.triage_status, 'in_progress');
    const done = setFindingTriage(f.id, { triageStatus: 'closed' });
    assert.strictEqual(done.triage_status, 'closed');
  });

  test('dismissed: dismissal_note persists', () => {
    initDB(':memory:');
    const a = createAsset({ name: 'h', type: 'host' });
    const f = createFinding({ assetId: a.id, title: 'x', severity: 'high' });
    const out = setFindingTriage(f.id, {
      triageStatus: 'dismissed',
      dismissalNote: 'Verified false positive — upstream fixed in v2.4',
    });
    assert.strictEqual(out.triage_status, 'dismissed');
    assert.match(out.dismissal_note, /false positive/);
  });

  test('dismissal_note is cleared when moving back out of dismissed', () => {
    initDB(':memory:');
    const a = createAsset({ name: 'h', type: 'host' });
    const f = createFinding({ assetId: a.id, title: 'x', severity: 'high' });
    setFindingTriage(f.id, { triageStatus: 'dismissed', dismissalNote: 'reason' });
    const out = setFindingTriage(f.id, { triageStatus: 'acknowledged' });
    assert.strictEqual(out.dismissal_note, null);
  });

  test('unknown triage_status rejected', () => {
    initDB(':memory:');
    const a = createAsset({ name: 'h', type: 'host' });
    const f = createFinding({ assetId: a.id, title: 'x', severity: 'low' });
    assert.throws(
      () => setFindingTriage(f.id, { triageStatus: 'banana' }),
      /unknown triage_status/,
    );
  });

  test('isHighSeverity helper', () => {
    assert.strictEqual(isHighSeverity('low'), false);
    assert.strictEqual(isHighSeverity('medium'), false);
    assert.strictEqual(isHighSeverity('high'), true);
    assert.strictEqual(isHighSeverity('critical'), true);
    assert.strictEqual(isHighSeverity(null), false);
  });
});
