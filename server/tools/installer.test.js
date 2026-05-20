import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectHost, resolveInstallPlan, summarizePlan,
  getInstallerStatus, toolIdsForTier,
} from './installer.js';
import { getCatalog } from './installer-catalog.js';

test('catalog covers all three tiers and every entry has a command name', () => {
  const catalog = getCatalog();
  assert.ok(catalog.length >= 20, 'catalog is non-trivial');
  for (const tool of catalog) {
    assert.ok(['base', 'offensive', 'blue'].includes(tool.tier), `${tool.id} tier`);
    assert.ok(tool.command && typeof tool.command === 'string', `${tool.id} command`);
    assert.ok(tool.packages && Object.keys(tool.packages).length, `${tool.id} packages`);
    assert.ok(tool.docs && /^https?:/.test(tool.docs), `${tool.id} docs URL`);
  }
});

test('detectHost returns the running platform with package-manager probes', () => {
  const prev = process.env.PHANTOM_BACKEND;
  delete process.env.PHANTOM_BACKEND;
  try {
    const host = detectHost();
    assert.ok(['win32', 'linux', 'darwin'].includes(host.os));
    assert.equal(typeof host.isDocker, 'boolean');
    assert.equal(typeof host.packageManagers, 'object');
    // preferred can be null on under-provisioned machines, but the field
    // must exist on the response.
    assert.ok('preferred' in host);
  } finally {
    if (prev === undefined) delete process.env.PHANTOM_BACKEND;
    else process.env.PHANTOM_BACKEND = prev;
  }
});

test('detectHost short-circuits to PHANTOM_BACKEND when env var is set', () => {
  const prev = process.env.PHANTOM_BACKEND;
  process.env.PHANTOM_BACKEND = 'apt';
  try {
    const host = detectHost();
    assert.equal(host.preferred, 'apt');
    assert.equal(host.packageManagers.apt, true);
    // The override stands in for whatever the actual host would have
    // resolved to — no other managers should leak through.
    assert.deepEqual(Object.keys(host.packageManagers), ['apt']);
  } finally {
    if (prev === undefined) delete process.env.PHANTOM_BACKEND;
    else process.env.PHANTOM_BACKEND = prev;
  }
});

test('detectHost runs normal detection when PHANTOM_BACKEND is unset', () => {
  const prev = process.env.PHANTOM_BACKEND;
  delete process.env.PHANTOM_BACKEND;
  try {
    const host = detectHost();
    // Without the override, packageManagers reflects actual probes —
    // which means multiple keys (apt/dnf/... or winget/choco/...) even
    // when their values are false. The override path only has one key.
    assert.ok(Object.keys(host.packageManagers).length > 1,
      'normal detection probes multiple managers');
  } finally {
    if (prev === undefined) delete process.env.PHANTOM_BACKEND;
    else process.env.PHANTOM_BACKEND = prev;
  }
});

test('resolveInstallPlan picks apt on Debian-like Linux when apt is present', () => {
  const fakeHost = {
    os: 'linux',
    distro: { id: 'ubuntu', idLike: 'debian' },
    isDocker: false,
    packageManagers: { apt: true, pipx: true, go: true },
    preferred: 'apt',
  };
  const plan = resolveInstallPlan(['nmap', 'sqlmap', 'ffuf'], fakeHost);
  assert.equal(plan.length, 3);
  assert.equal(plan[0].backend, 'apt');
  assert.equal(plan[0].command, 'sudo');
  assert.deepEqual(plan[0].args, ['apt-get', 'install', '-y', 'nmap']);
  assert.equal(plan[1].backend, 'apt');
  assert.equal(plan[2].backend, 'apt');
});

test('resolveInstallPlan prefers winget on Windows when winget is present', () => {
  const fakeHost = {
    os: 'win32',
    distro: null,
    isDocker: false,
    packageManagers: { winget: true, choco: false, scoop: false, pipx: false, go: false, wsl: true },
    preferred: 'winget',
  };
  const plan = resolveInstallPlan(['nmap', 'wireshark', 'masscan'], fakeHost);
  assert.equal(plan[0].backend, 'winget');
  assert.equal(plan[0].command, 'winget');
  assert.ok(plan[0].args.includes('--silent'), 'winget runs silent');
  assert.equal(plan[1].backend, 'winget', 'wireshark has a winget id');
  // masscan has no winget id, so resolution should fall back. Since
  // choco/scoop are off but wsl is on, expect wsl-apt.
  assert.equal(plan[2].backend, 'wsl-apt');
  assert.equal(plan[2].command, 'wsl');
});

test('resolveInstallPlan reports unresolvable tools with a reason', () => {
  const fakeHost = {
    os: 'win32',
    distro: null,
    isDocker: false,
    packageManagers: { winget: false, choco: false, scoop: false, pipx: false, go: false, wsl: false },
    preferred: null,
  };
  const plan = resolveInstallPlan(['nmap'], fakeHost);
  assert.equal(plan[0].backend, null);
  assert.match(plan[0].reason, /no package available/);
});

test('summarizePlan returns counts and skip reasons', () => {
  const fakeHost = {
    os: 'linux',
    distro: { id: 'fedora' },
    isDocker: false,
    packageManagers: { dnf: true },
    preferred: 'dnf',
  };
  // whatweb has no dnf package; nmap does.
  const plan = resolveInstallPlan(['nmap', 'whatweb'], fakeHost);
  const summary = summarizePlan(plan);
  assert.equal(summary.total, 2);
  assert.equal(summary.installable, 1);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(summary.backends, ['dnf']);
  assert.equal(Object.values(summary.bySkipReason)[0], 1);
});

test('unknown tool ids are reported but do not throw', () => {
  const plan = resolveInstallPlan(['does-not-exist'], {
    os: 'linux', distro: null, isDocker: false,
    packageManagers: { apt: true }, preferred: 'apt',
  });
  assert.equal(plan[0].backend, null);
  assert.equal(plan[0].tool, null);
  assert.equal(plan[0].reason, 'unknown tool id');
});

test('toolIdsForTier returns the tier subset', () => {
  const base = toolIdsForTier('base');
  const offensive = toolIdsForTier('offensive');
  const blue = toolIdsForTier('blue');
  assert.ok(base.length >= 5);
  assert.ok(offensive.length >= 4);
  assert.ok(blue.length >= 4);
  // Sets are disjoint.
  assert.equal(new Set([...base, ...offensive, ...blue]).size, base.length + offensive.length + blue.length);
});

test('getInstallerStatus tallies installed-per-tier counts', () => {
  // We stub commandExists so the tier counts are deterministic regardless
  // of what's on PATH on the test host.
  const present = new Set(['nmap', 'ffuf', 'sqlmap']);
  const status = getInstallerStatus({ commandExists: (cmd) => present.has(cmd) });
  assert.equal(status.byTier.base.total, status.tools.filter(t => t.tier === 'base').length);
  assert.ok(status.byTier.base.installed >= 3, 'three stubbed-present base tools');
  assert.equal(status.byTier.offensive.installed, 0);
  assert.equal(status.byTier.blue.installed, 0);
});
