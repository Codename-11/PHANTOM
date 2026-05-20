import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB } from '../memory/store.js';
import {
  createProfile,
  getProfile,
  getProfileByName,
  listProfiles,
  updateProfile,
  deleteProfile,
} from './profile-store.js';

describe('profile-store', () => {
  beforeEach(() => {
    // Fresh in-memory DB per test — profile-store.js bootstraps the
    // `profiles` table lazily so it picks up the new handle on first call.
    initDB(':memory:');
  });

  after(() => {
    closeDB();
  });

  test('createProfile + getProfile round-trips name, description, toolIds', () => {
    const created = createProfile({
      name: 'offensive',
      description: 'Red-team baseline',
      toolIds: ['nmap', 'ffuf', 'sqlmap'],
    });
    assert.ok(created.id, 'profile should have an id');
    assert.equal(created.name, 'offensive');
    assert.equal(created.description, 'Red-team baseline');
    assert.deepEqual(created.tool_ids, ['nmap', 'ffuf', 'sqlmap']);
    assert.equal(typeof created.created_at, 'number', 'created_at is ms-epoch integer');
    assert.equal(typeof created.updated_at, 'number', 'updated_at is ms-epoch integer');
    assert.equal(created.created_at, created.updated_at, 'matched on create');

    const fetched = getProfile(created.id);
    assert.deepEqual(fetched, created);

    const byName = getProfileByName('offensive');
    assert.equal(byName.id, created.id);
  });

  test('createProfile rejects duplicate names', () => {
    createProfile({ name: 'blue', toolIds: ['suricata'] });
    assert.throws(
      () => createProfile({ name: 'blue', toolIds: ['zeek'] }),
      /already exists/i,
    );
  });

  test('createProfile requires a non-empty name', () => {
    assert.throws(() => createProfile({ name: '   ', toolIds: ['nmap'] }), /name is required/i);
    assert.throws(() => createProfile({ toolIds: ['nmap'] }), /name is required/i);
  });

  test('createProfile dedupes toolIds while preserving order', () => {
    const profile = createProfile({
      name: 'dedupe',
      toolIds: ['nmap', 'ffuf', 'nmap', 'sqlmap', 'ffuf'],
    });
    assert.deepEqual(profile.tool_ids, ['nmap', 'ffuf', 'sqlmap']);
  });

  test('listProfiles orders by updated_at DESC (most recently touched first)', () => {
    const first = createProfile({ name: 'alpha', toolIds: ['nmap'] });
    const second = createProfile({ name: 'beta', toolIds: ['ffuf'] });
    // Touch `first` so its updated_at jumps ahead of `second.updated_at`.
    // updateProfile() forces a strictly-greater timestamp, so no sleep
    // is needed even when wall-clock resolution is coarse.
    updateProfile(first.id, { description: 'touched' });

    const list = listProfiles();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, first.id, 'most recently updated profile comes first');
    assert.equal(list[1].id, second.id);
  });

  test('updateProfile bumps updated_at and persists patch fields', () => {
    const created = createProfile({ name: 'patchable', toolIds: ['nmap'] });
    const initialUpdatedAt = created.updated_at;

    const updated = updateProfile(created.id, {
      description: 'now with description',
      toolIds: ['nmap', 'masscan'],
    });
    assert.equal(updated.name, 'patchable', 'unspecified name field stays unchanged');
    assert.equal(updated.description, 'now with description');
    assert.deepEqual(updated.tool_ids, ['nmap', 'masscan']);
    assert.ok(updated.updated_at > initialUpdatedAt, 'updated_at should be strictly greater');
    assert.equal(updated.created_at, created.created_at, 'created_at is immutable');
  });

  test('updateProfile returns null for an unknown id', () => {
    assert.equal(updateProfile('does-not-exist', { description: 'x' }), null);
  });

  test('updateProfile rejects renaming to a clashing name', () => {
    const a = createProfile({ name: 'one', toolIds: ['nmap'] });
    createProfile({ name: 'two', toolIds: ['ffuf'] });
    assert.throws(
      () => updateProfile(a.id, { name: 'two' }),
      /already exists/i,
    );
  });

  test('deleteProfile removes the row and returns true; missing ids return false', () => {
    const created = createProfile({ name: 'doomed', toolIds: ['nmap'] });
    assert.equal(deleteProfile(created.id), true);
    assert.equal(getProfile(created.id), null);
    assert.equal(deleteProfile(created.id), false, 're-deletion returns false');
    assert.equal(deleteProfile('never-existed'), false);
  });

  test('getProfile / getProfileByName return null for missing keys', () => {
    assert.equal(getProfile('missing'), null);
    assert.equal(getProfile(null), null);
    assert.equal(getProfileByName('nope'), null);
  });
});
