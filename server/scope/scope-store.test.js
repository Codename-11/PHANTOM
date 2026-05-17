import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { initDB, closeDB } from '../memory/store.js';
import { createScope, getScope, getScopes, updateScope, archiveScope } from './scope-store.js';

describe('scope store', () => {
  afterEach(() => closeDB());

  test('creates, lists, updates, and archives scopes with parsed JSON fields', () => {
    initDB(':memory:');
    const scope = createScope({
      name: 'Local lab',
      targets: { hosts: ['127.0.0.1'], domains: ['example.com'], cidrs: ['192.168.1.0/24'], urls: ['https://example.com/app'] },
      allowedActions: ['read/local', 'recon'],
      blockedActions: ['destructive'],
      credentialRefs: ['vault:lab-user'],
      notes: 'Rules of engagement here.',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    assert.ok(scope.id);
    assert.deepStrictEqual(scope.targets.hosts, ['127.0.0.1']);
    assert.deepStrictEqual(scope.allowed_actions, ['read/local', 'recon']);
    assert.ok(!JSON.stringify(scope).includes('targets_json'));

    const saved = getScope(scope.id);
    assert.strictEqual(saved.name, 'Local lab');
    assert.deepStrictEqual(saved.credential_refs, ['vault:lab-user']);

    const updated = updateScope(scope.id, { name: 'Updated lab', blockedActions: ['destructive', 'exploit'] });
    assert.strictEqual(updated.name, 'Updated lab');
    assert.deepStrictEqual(updated.blocked_actions, ['destructive', 'exploit']);

    assert.ok(getScopes().some(item => item.id === scope.id));
    archiveScope(scope.id);
    assert.strictEqual(getScopes().some(item => item.id === scope.id), false);
    assert.strictEqual(getScopes({ includeArchived: true }).some(item => item.id === scope.id), true);
  });
});
