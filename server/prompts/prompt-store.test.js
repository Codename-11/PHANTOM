import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { initDB, closeDB } from '../memory/store.js';
import { createScope } from '../scope/scope-store.js';
import { createPromptProfile, createPromptFragment, getPromptProfiles, getPromptFragments, updatePromptFragment, resolvePrompt } from './prompt-store.js';

describe('prompt profile and fragment store', () => {
  afterEach(() => closeDB());

  test('persists profiles/fragments and resolves prompt layers in order', () => {
    initDB(':memory:');
    const scope = createScope({ name: 'Scope A', targets: { hosts: ['example.com'] }, notes: 'Only test example.com.' });
    const profile = createPromptProfile({ name: 'Recon', description: 'Recon mode', mode: 'recon', isDefault: true });
    createPromptFragment({ kind: 'base', name: 'Base safety', body: 'BASE FRAGMENT', position: 10 });
    createPromptFragment({ profileId: profile.id, kind: 'mode', name: 'Recon mode', body: 'MODE FRAGMENT', position: 20 });
    createPromptFragment({ kind: 'policy', name: 'Policy', body: 'POLICY FRAGMENT', position: 30 });
    createPromptFragment({ kind: 'custom', name: 'Custom', body: 'CUSTOM FRAGMENT', enabled: false, position: 40 });
    const custom = createPromptFragment({ kind: 'custom', name: 'Enabled custom', body: 'CUSTOM ENABLED', position: 50 });

    assert.strictEqual(getPromptProfiles()[0].name, 'Recon');
    assert.ok(getPromptFragments().some(fragment => fragment.id === custom.id));

    const updated = updatePromptFragment(custom.id, { body: 'CUSTOM UPDATED' });
    assert.strictEqual(updated.body, 'CUSTOM UPDATED');

    const resolved = resolvePrompt({ basePrompt: 'SYSTEM BASE', profileId: profile.id, scopeId: scope.id });
    const content = resolved.content;
    assert.ok(content.includes('SYSTEM BASE'));
    assert.ok(content.indexOf('SYSTEM BASE') < content.indexOf('BASE FRAGMENT'));
    assert.ok(content.indexOf('BASE FRAGMENT') < content.indexOf('MODE FRAGMENT'));
    assert.ok(content.indexOf('MODE FRAGMENT') < content.indexOf('Scope: Scope A'));
    assert.ok(content.indexOf('Scope: Scope A') < content.indexOf('POLICY FRAGMENT'));
    assert.ok(content.indexOf('POLICY FRAGMENT') < content.indexOf('CUSTOM UPDATED'));
    assert.ok(!content.includes('CUSTOM FRAGMENT'));
    assert.strictEqual(resolved.profile.name, 'Recon');
    assert.strictEqual(resolved.scope.name, 'Scope A');
    assert.ok(resolved.snapshot.fragmentIds.includes(updated.id));
  });
});
