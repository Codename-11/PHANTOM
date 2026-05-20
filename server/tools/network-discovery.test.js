import { describe, test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  discoverLocalNetwork,
  parseArpA,
  parseIpNeigh,
  pickPlatformProbe,
  renderNeighborsMarkdown,
  _resetCache,
  _peekCache,
} from './network-discovery.js';

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Captured from real `arp -a` / `ip neigh show` runs (sanitized). Keeping them
// inline keeps the test self-contained and avoids needing a fixture directory.

const WIN_ARP_FIXTURE = `
Interface: 192.168.1.10 --- 0xc
  Internet Address      Physical Address      Type
  192.168.1.1           aa-bb-cc-dd-ee-01     dynamic
  192.168.1.55          aa-bb-cc-dd-ee-55     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static

Interface: 10.0.0.42 --- 0x14
  Internet Address      Physical Address      Type
  10.0.0.1              11-22-33-44-55-66     dynamic
`;

const DARWIN_ARP_FIXTURE = `
? (192.168.1.1) at aa:bb:cc:dd:ee:01 on en0 ifscope [ethernet]
gateway.local (192.168.1.254) at aa:bb:cc:dd:ee:fe on en0 ifscope [ethernet]
? (192.168.1.55) at aa:bb:cc:dd:ee:55 on en0 ifscope [ethernet]
? (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]
`;

const LINUX_NEIGH_FIXTURE = `
192.168.1.1 dev wlan0 lladdr aa:bb:cc:dd:ee:01 REACHABLE
192.168.1.55 dev wlan0 lladdr aa:bb:cc:dd:ee:55 STALE
192.168.1.99 dev wlan0  FAILED
192.168.1.7 dev wlan0 lladdr 00:00:00:00:00:00 INCOMPLETE
10.0.0.1 dev eth0 lladdr 11:22:33:44:55:66 PERMANENT
fe80::1 dev wlan0 lladdr aa:bb:cc:dd:ee:01 REACHABLE
`;

// ── Parser unit tests ───────────────────────────────────────────────────────

describe('network-discovery parsers', () => {
  test('parseArpA handles Windows `arp -a` format', () => {
    const out = parseArpA(WIN_ARP_FIXTURE);
    const ips = out.map((n) => n.ip).sort();
    assert.deepStrictEqual(ips, ['10.0.0.1', '192.168.1.1', '192.168.1.55']);
    // Broadcast MAC and multicast / broadcast IP rows are filtered.
    assert.ok(!out.some((n) => n.mac === 'ff:ff:ff:ff:ff:ff'));
    assert.ok(!out.some((n) => n.ip === '224.0.0.22'), 'multicast IPs filtered');
    assert.ok(!out.some((n) => n.ip === '192.168.1.255'), 'broadcast row filtered via broadcast MAC');
    // MACs are normalized to colon form, lower-case.
    for (const n of out) assert.match(n.mac, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/);
  });

  test('parseArpA handles macOS `arp -a` format', () => {
    const out = parseArpA(DARWIN_ARP_FIXTURE);
    const byIp = Object.fromEntries(out.map((n) => [n.ip, n]));
    assert.ok(byIp['192.168.1.1'], 'parses ? sentinel row');
    assert.strictEqual(byIp['192.168.1.1'].mac, 'aa:bb:cc:dd:ee:01');
    assert.strictEqual(byIp['192.168.1.1'].interface, 'en0');
    assert.strictEqual(byIp['192.168.1.254'].hostname, 'gateway.local',
      'named hostnames are captured');
    assert.ok(byIp['192.168.1.1'].hostname === undefined,
      '? sentinel is dropped, not stored as the hostname');
    assert.ok(!byIp['192.168.1.99'], 'incomplete neighbor rows are skipped');
  });

  test('parseIpNeigh handles Linux `ip neigh show` format', () => {
    const out = parseIpNeigh(LINUX_NEIGH_FIXTURE);
    const ips = out.map((n) => n.ip).sort();
    // IPv4-only for this phase (deferred: IPv6 neighbors).
    assert.deepStrictEqual(ips, ['10.0.0.1', '192.168.1.1', '192.168.1.55']);
    const byIp = Object.fromEntries(out.map((n) => [n.ip, n]));
    assert.strictEqual(byIp['192.168.1.1'].interface, 'wlan0');
    assert.strictEqual(byIp['10.0.0.1'].interface, 'eth0');
    assert.ok(!out.some((n) => n.mac === '00:00:00:00:00:00'),
      'all-zero MAC is treated as unusable');
  });

  test('parsers dedupe duplicate rows', () => {
    const doubled = WIN_ARP_FIXTURE + WIN_ARP_FIXTURE;
    const out = parseArpA(doubled);
    const ips = out.map((n) => n.ip);
    assert.strictEqual(new Set(ips).size, ips.length, 'no duplicate IP+MAC pairs survive');
  });

  test('parsers tolerate empty / nonsense input', () => {
    assert.deepStrictEqual(parseArpA(''), []);
    assert.deepStrictEqual(parseArpA(null), []);
    assert.deepStrictEqual(parseIpNeigh(''), []);
    assert.deepStrictEqual(parseIpNeigh('garbage line with no ip'), []);
  });
});

// ── Platform dispatcher ─────────────────────────────────────────────────────

describe('network-discovery platform dispatcher', () => {
  test('linux dispatches to ip neigh show', () => {
    const probe = pickPlatformProbe('linux');
    assert.strictEqual(probe.file, 'ip');
    assert.deepStrictEqual(probe.args, ['neigh', 'show']);
    assert.strictEqual(probe.kind, 'ip-neigh');
  });
  test('win32 dispatches to arp -a', () => {
    const probe = pickPlatformProbe('win32');
    assert.strictEqual(probe.file, 'arp');
    assert.deepStrictEqual(probe.args, ['-a']);
    assert.strictEqual(probe.kind, 'arp-a');
  });
  test('darwin dispatches to arp -a', () => {
    const probe = pickPlatformProbe('darwin');
    assert.strictEqual(probe.file, 'arp');
    assert.deepStrictEqual(probe.args, ['-a']);
  });
  test('unknown platform falls back to arp -a', () => {
    const probe = pickPlatformProbe('aix');
    assert.strictEqual(probe.file, 'arp');
  });
});

// ── End-to-end discoverLocalNetwork via mocked execFile ─────────────────────

function fakeExecFile(fixture, errToThrow = null) {
  return (file, args, opts, cb) => {
    setImmediate(() => {
      if (errToThrow) cb(errToThrow, '', errToThrow.stderr || '');
      else cb(null, fixture, '');
    });
    return { kill: () => {} };
  };
}

describe('discoverLocalNetwork', () => {
  beforeEach(() => _resetCache());
  afterEach(() => _resetCache());

  test('linux platform uses ip neigh parser', async () => {
    const result = await discoverLocalNetwork({
      execFile: fakeExecFile(LINUX_NEIGH_FIXTURE),
      osPlatform: 'linux',
      ifaceMap: { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] },
    });
    assert.strictEqual(result.platform, 'linux');
    assert.strictEqual(result.probe, 'ip-neigh');
    assert.ok(result.neighbors.some((n) => n.ip === '192.168.1.1'));
    assert.strictEqual(result.cached, false);
  });

  test('win32 platform uses arp parser', async () => {
    const result = await discoverLocalNetwork({
      execFile: fakeExecFile(WIN_ARP_FIXTURE),
      osPlatform: 'win32',
      ifaceMap: { Ethernet: [{ family: 'IPv4', address: '192.168.1.10', internal: false }] },
    });
    assert.strictEqual(result.platform, 'win32');
    assert.strictEqual(result.probe, 'arp-a');
    assert.ok(result.neighbors.length >= 3);
  });

  test('darwin platform uses arp parser', async () => {
    const result = await discoverLocalNetwork({
      execFile: fakeExecFile(DARWIN_ARP_FIXTURE),
      osPlatform: 'darwin',
      ifaceMap: { en0: [{ family: 'IPv4', address: '192.168.1.10', internal: false }] },
    });
    assert.strictEqual(result.platform, 'darwin');
    assert.strictEqual(result.probe, 'arp-a');
    const named = result.neighbors.find((n) => n.hostname === 'gateway.local');
    assert.ok(named, 'hostname is captured from macOS arp output');
  });

  test('60s cache returns same result without re-spawning', async () => {
    let calls = 0;
    const execFile = (file, args, opts, cb) => {
      calls += 1;
      setImmediate(() => cb(null, LINUX_NEIGH_FIXTURE, ''));
      return { kill: () => {} };
    };
    const ifaceMap = { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] };
    const first = await discoverLocalNetwork({ execFile, osPlatform: 'linux', ifaceMap, now: 1_000_000 });
    const second = await discoverLocalNetwork({ execFile, osPlatform: 'linux', ifaceMap, now: 1_010_000 });
    assert.strictEqual(calls, 1, 'second call within TTL hits the cache');
    assert.strictEqual(second.cached, true);
    // Past the 60s window the cache is bypassed.
    const third = await discoverLocalNetwork({ execFile, osPlatform: 'linux', ifaceMap, now: 1_000_000 + 61_000 });
    assert.strictEqual(calls, 2, 'expired cache re-runs the probe');
    assert.strictEqual(third.cached, false);
    // Compare against the first result for stability.
    assert.deepStrictEqual(third.neighbors.map((n) => n.ip).sort(), first.neighbors.map((n) => n.ip).sort());
  });

  test('cache key invalidates when interface set changes', async () => {
    let calls = 0;
    const execFile = (file, args, opts, cb) => {
      calls += 1;
      setImmediate(() => cb(null, LINUX_NEIGH_FIXTURE, ''));
      return { kill: () => {} };
    };
    await discoverLocalNetwork({
      execFile, osPlatform: 'linux', now: 1_000_000,
      ifaceMap: { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] },
    });
    await discoverLocalNetwork({
      execFile, osPlatform: 'linux', now: 1_001_000,
      ifaceMap: { wlan0: [{ family: 'IPv4', address: '172.16.1.42', internal: false }] },
    });
    assert.strictEqual(calls, 2, 'changing interface fingerprint busts the cache');
  });

  test('force:true bypasses the cache', async () => {
    let calls = 0;
    const execFile = (file, args, opts, cb) => {
      calls += 1;
      setImmediate(() => cb(null, LINUX_NEIGH_FIXTURE, ''));
      return { kill: () => {} };
    };
    const ifaceMap = { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] };
    await discoverLocalNetwork({ execFile, osPlatform: 'linux', ifaceMap, now: 1_000_000 });
    await discoverLocalNetwork({ execFile, osPlatform: 'linux', ifaceMap, now: 1_010_000, force: true });
    assert.strictEqual(calls, 2, 'force:true skips the cache');
  });

  test('spawn error returns empty neighbors with error string', async () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    const result = await discoverLocalNetwork({
      execFile: fakeExecFile('', err),
      osPlatform: 'linux',
      ifaceMap: { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] },
    });
    assert.deepStrictEqual(result.neighbors, []);
    assert.match(result.error, /ENOENT/);
  });
});

// ── Markdown rendering ──────────────────────────────────────────────────────

describe('renderNeighborsMarkdown', () => {
  test('renders a table preview', () => {
    const md = renderNeighborsMarkdown([
      { ip: '192.168.1.1', mac: 'aa:bb:cc:dd:ee:01', interface: 'en0', hostname: 'gw' },
      { ip: '192.168.1.55', mac: 'aa:bb:cc:dd:ee:55', interface: 'en0' },
    ]);
    assert.match(md, /\| IP \| MAC/);
    assert.match(md, /192\.168\.1\.1/);
    assert.match(md, /gw/);
  });
  test('empty list returns a hint, not an empty string', () => {
    assert.match(renderNeighborsMarkdown([]), /No neighbors/);
    assert.match(renderNeighborsMarkdown(null), /No neighbors/);
  });
  test('truncates very long lists', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ip: `10.0.0.${i + 1}`, mac: `aa:bb:cc:dd:ee:${(i + 1).toString(16).padStart(2, '0')}` }));
    const md = renderNeighborsMarkdown(many, { limit: 5 });
    const rows = md.split('\n').filter((l) => l.startsWith('|') && !/IP \|/.test(l) && !/---/.test(l));
    assert.strictEqual(rows.length, 5);
    assert.match(md, /\+45 more/);
  });
});

// ── Tool dispatch (policy gate + artifact + trace) ──────────────────────────
//
// These cover the phantom_discover_local_network branch inside phantom-tools.js:
//   - policy gate rejection when recon is denied
//   - successful invocation writes the artifact + traces COUNT only
//   - acknowledgedNoScope flag propagates

import { initDB, closeDB, createConversation, createRun, getTraceEvents } from '../memory/store.js';
import { executePhantomTool } from './phantom-tools.js';
import { createScope } from '../scope/scope-store.js';
import { getArtifactsForRun } from '../memory/store.js';

function freshRun() {
  initDB(':memory:');
  const conv = createConversation('discover-test');
  const run = createRun({ conversationId: conv.id, title: 'discover', goal: 'discover', model: 'm', providerRoute: 'p' });
  return { conv, run };
}

describe('phantom_discover_local_network dispatch', () => {
  afterEach(() => { _resetCache(); try { closeDB(); } catch {} });

  test('policy gate rejects when scope denies recon', async () => {
    const { run } = freshRun();
    const scope = createScope({
      name: 'no-recon',
      targets: { hosts: [], domains: [], cidrs: [], urls: [] },
      allowedActions: [],
      blockedActions: ['recon'],
    });
    const out = await executePhantomTool('phantom_discover_local_network', {}, {
      scope, runId: run.id,
      _execFile: fakeExecFile(LINUX_NEIGH_FIXTURE),
      _osPlatform: 'linux',
      _ifaceMap: { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] },
    });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.allowed, false);
    assert.strictEqual(parsed.risk, 'recon');
    assert.match(parsed.reason || '', /recon/);

    // A tool.call.blocked trace event is recorded.
    const events = getTraceEvents(run.id);
    const blocked = events.find((e) => e.type === 'tool.call.blocked');
    assert.ok(blocked, 'tool.call.blocked event written');
    assert.strictEqual(blocked.metadata?.risk, 'recon');
    // No IPs leak into the trace.
    const serialized = JSON.stringify(blocked);
    assert.ok(!/192\.168\.1\.1/.test(serialized), 'blocked trace does not contain neighbor IPs');
  });

  test('successful invocation writes an artifact and traces COUNT only', async () => {
    const { run } = freshRun();
    const scope = createScope({
      name: 'recon-ok',
      targets: { hosts: [], domains: [], cidrs: [], urls: [] },
      allowedActions: ['recon'],
    });
    const out = await executePhantomTool('phantom_discover_local_network', {}, {
      scope, runId: run.id,
      _execFile: fakeExecFile(LINUX_NEIGH_FIXTURE),
      _osPlatform: 'linux',
      _ifaceMap: { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] },
    });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.allowed, true);
    assert.ok(parsed.count >= 1, 'count is surfaced');
    assert.ok(Array.isArray(parsed.neighbors));
    assert.ok(parsed.artifactId, 'artifact id is returned');
    assert.ok(parsed.markdown_preview, 'markdown preview is returned for the LLM');

    // The artifact file exists and contains the neighbor JSON.
    const artifacts = getArtifactsForRun(run.id);
    const netArt = artifacts.find((a) => /network-neighbors/i.test(a.title) || /network-neighbors/.test(a.path));
    assert.ok(netArt, 'network-neighbors.json artifact was written');
    assert.ok(existsSync(netArt.path));
    const payload = JSON.parse(readFileSync(netArt.path, 'utf8'));
    assert.ok(Array.isArray(payload.neighbors));
    assert.ok(payload.neighbors.length >= 1);

    // Trace event records COUNT only — no IPs leaked.
    const events = getTraceEvents(run.id);
    const tool = events.find((e) => e.tool_name === 'phantom_discover_local_network' && e.metadata?.count !== undefined);
    assert.ok(tool, 'tool trace event recorded');
    assert.strictEqual(typeof tool.metadata.count, 'number');
    assert.strictEqual(tool.metadata.risk, 'recon');
    const ser = JSON.stringify(tool);
    assert.ok(!/192\.168\.1\.1/.test(ser), 'trace event does not contain neighbor IPs');
    assert.ok(!/aa:bb:cc:dd/.test(ser), 'trace event does not contain neighbor MACs');
  });

  test('acknowledgedNoScope flag propagates onto the trace when scope is absent', async () => {
    const { run } = freshRun();
    const out = await executePhantomTool('phantom_discover_local_network', { acknowledgedNoScope: true }, {
      scope: null, runId: run.id,
      _execFile: fakeExecFile(LINUX_NEIGH_FIXTURE),
      _osPlatform: 'linux',
      _ifaceMap: { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] },
    });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.allowed, true);
    assert.strictEqual(parsed.acknowledgedNoScope, true);

    const events = getTraceEvents(run.id);
    const tool = events.find((e) => e.tool_name === 'phantom_discover_local_network' && e.metadata?.acknowledgedNoScope);
    assert.ok(tool, 'acknowledgedNoScope=true is recorded on the trace metadata');
  });

  test('no scope + no acknowledgement is blocked', async () => {
    const { run } = freshRun();
    const out = await executePhantomTool('phantom_discover_local_network', {}, {
      scope: null, runId: run.id,
      _execFile: fakeExecFile(LINUX_NEIGH_FIXTURE),
      _osPlatform: 'linux',
      _ifaceMap: { eth0: [{ family: 'IPv4', address: '10.0.0.42', internal: false }] },
    });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.allowed, false);
    assert.match(parsed.reason || '', /scope|acknowledg/i);
  });
});
