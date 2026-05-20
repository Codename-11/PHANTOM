import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB } from '../memory/store.js';
import { createProfile } from './profile-store.js';
import {
  expandProfile,
  renderProfileAsDockerfile,
  resolveProfileAsInstallPlan,
} from './profile-resolver.js';

describe('profile-resolver', () => {
  beforeEach(() => {
    initDB(':memory:');
  });

  after(() => {
    closeDB();
  });

  test('expandProfile returns the stored tool ids verbatim', () => {
    const profile = createProfile({
      name: 'recon',
      toolIds: ['nmap', 'ffuf', 'whatweb'],
    });
    assert.deepEqual(expandProfile(profile.id), ['nmap', 'ffuf', 'whatweb']);
  });

  test('expandProfile throws PROFILE_NOT_FOUND for an unknown id', () => {
    assert.throws(
      () => expandProfile('does-not-exist'),
      (err) => err.code === 'PROFILE_NOT_FOUND' && /profile not found/i.test(err.message),
    );
  });

  test('renderProfileAsDockerfile emits a comment header and a RUN call by name', () => {
    const profile = createProfile({
      name: 'offensive',
      description: 'Red-team baseline',
      toolIds: ['nmap', 'sqlmap'],
    });
    const fragment = renderProfileAsDockerfile(profile.id);

    // Header comment surfaces the profile name and tool list so a human
    // reviewing the rendered Dockerfile can see what's in the layer.
    assert.match(fragment, /^# profile: offensive$/m);
    assert.match(fragment, /^# tools: nmap, sqlmap$/m);
    assert.match(fragment, /^# Red-team baseline$/m);
    // Single RUN call into the Phase-3 installer script — Phase 3 owns the
    // actual apt/pipx/go orchestration, so the fragment stays tiny.
    assert.match(fragment, /^RUN \/tmp\/install-profile\.sh "offensive"$/m);
    assert.ok(fragment.endsWith('\n'), 'fragment is newline-terminated');
  });

  test('renderProfileAsDockerfile escapes quotes in the profile name', () => {
    const profile = createProfile({
      name: 'weird"name',
      toolIds: ['nmap'],
    });
    const fragment = renderProfileAsDockerfile(profile.id);
    assert.match(fragment, /RUN \/tmp\/install-profile\.sh "weird\\"name"/);
  });

  test('renderProfileAsDockerfile handles empty tool lists gracefully', () => {
    const profile = createProfile({ name: 'empty', toolIds: [] });
    const fragment = renderProfileAsDockerfile(profile.id);
    assert.match(fragment, /^# tools: \(none\)$/m);
  });

  test('renderProfileAsDockerfile throws for an unknown id', () => {
    assert.throws(
      () => renderProfileAsDockerfile('does-not-exist'),
      (err) => err.code === 'PROFILE_NOT_FOUND',
    );
  });

  test('resolveProfileAsInstallPlan delegates to the installer with the expanded tool list', () => {
    const profile = createProfile({
      name: 'plan',
      toolIds: ['nmap', 'ffuf'],
    });
    // Pass a deterministic Linux host so the test doesn't depend on the
    // CI host's package managers. The installer test file does the same
    // (see server/tools/installer.test.js).
    const fakeHost = {
      os: 'linux',
      distro: { id: 'ubuntu', idLike: 'debian' },
      isDocker: false,
      packageManagers: { apt: true, pipx: true, go: true },
      preferred: 'apt',
    };
    const plan = resolveProfileAsInstallPlan(profile.id, fakeHost);
    assert.equal(plan.length, 2);
    assert.equal(plan[0].id, 'nmap');
    assert.equal(plan[0].backend, 'apt');
    assert.equal(plan[1].id, 'ffuf');
    assert.equal(plan[1].backend, 'apt');
  });

  test('resolveProfileAsInstallPlan throws for an unknown id', () => {
    assert.throws(
      () => resolveProfileAsInstallPlan('does-not-exist'),
      (err) => err.code === 'PROFILE_NOT_FOUND',
    );
  });
});
