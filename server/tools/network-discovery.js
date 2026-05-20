// Passive local-network discovery.
//
// Reads the host's ARP / IP-neighbor table. Does NOT send any probes — every
// entry returned is something the kernel already learned through ordinary
// LAN traffic. The output feeds the Assets "scan this machine's network"
// modal: discovered IPs land as DRAFT assets that the operator confirms.
//
// Cross-platform via three parsers:
//   - win32 / darwin → `arp -a`
//   - linux          → `ip neigh show`
//
// Caching: results are memoized for 60s keyed by the local interface set so
// repeated UI calls (e.g. modal re-open) don't keep shelling out.
//
// Trace + artifact policy lives in phantom-tools.js — this module is the
// pure parser + cache layer so it can be unit-tested without the trace bus.

import { execFile as nodeExecFile } from 'node:child_process';
import { platform, networkInterfaces } from 'node:os';

const SPAWN_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60_000;

// Module-private cache. Tests can wipe it via _resetCache().
let _cache = null;

function nowMs() { return Date.now(); }

function execFilePromise(execFileImpl, file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child && child.kill(); } catch { /* best-effort */ }
      reject(new Error(`network-discovery: ${file} timed out after ${SPAWN_TIMEOUT_MS}ms`));
    }, SPAWN_TIMEOUT_MS);
    try {
      child = execFileImpl(file, args, { ...opts, timeout: SPAWN_TIMEOUT_MS }, (err, stdout, stderr) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          // Surface stderr in the rejection so callers can decide whether the
          // tool simply isn't installed (parser returns []) vs. a real fault.
          err.stderr = String(stderr || '');
          err.stdout = String(stdout || '');
          return reject(err);
        }
        resolve(String(stdout || ''));
      });
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    }
  });
}

// ── Platform parsers ────────────────────────────────────────────────────────

// Normalize a MAC address: lower-case, colon-separated. Accepts colon,
// dash, or dot separators. Returns null if the token isn't 6 hex bytes.
function normalizeMac(raw) {
  if (!raw) return null;
  const hex = String(raw).toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

// Reject placeholder MACs that the ARP table sometimes returns when an entry
// is incomplete or resolving — these convey no real neighbor identity.
function isUsableMac(mac) {
  if (!mac) return false;
  if (/^(00:00:00:00:00:00|ff:ff:ff:ff:ff:ff)$/.test(mac)) return false;
  return true;
}

// IPv4 multicast (224.0.0.0/4) and limited-broadcast (255.255.255.255) are
// not "neighbors" in the operationally useful sense — skip them.
function isUsableIp(ip) {
  if (!ip) return false;
  if (ip === '255.255.255.255') return false;
  const first = Number(String(ip).split('.')[0]);
  if (first >= 224) return false; // multicast (224–239) + reserved (240+)
  return true;
}

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/;

// Windows / macOS `arp -a` output (both ship the same general layout):
//
//   Interface: 192.168.1.10 --- 0xc
//     Internet Address      Physical Address      Type
//     192.168.1.1           aa-bb-cc-dd-ee-ff     dynamic
//
//   ? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
//
// We accept either dialect.
export function parseArpA(stdout) {
  if (!stdout) return [];
  const out = [];
  let currentInterface = null;
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const winIfaceMatch = /^Interface:\s+(\S+)/i.exec(line);
    if (winIfaceMatch) { currentInterface = winIfaceMatch[1]; continue; }
    // Skip header rows.
    if (/^Internet Address\s+Physical Address/i.test(line)) continue;

    // macOS / BSD-style:  ? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ...
    const mac0 = /at\s+([0-9a-fA-F:.-]+)/.exec(line);
    const mac1 = /\b([0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2}\b/.exec(line);
    const ipMatch = line.match(IPV4_RE);
    if (!ipMatch || !isUsableIp(ipMatch[0])) continue;
    const ifaceMatch = /\bon\s+(\S+)/.exec(line);
    const macRaw = (mac0 && mac0[1]) || (mac1 && mac1[0]) || null;
    const mac = normalizeMac(macRaw);
    if (!isUsableMac(mac)) continue;

    // Optional hostname: macOS format is "<host> (<ip>) at ..." where <host>
    // may be the literal "?" sentinel. Drop the sentinel.
    let hostname;
    const hostMatch = /^(\S+)\s+\(/.exec(line);
    if (hostMatch && hostMatch[1] !== '?') hostname = hostMatch[1];

    out.push({
      ip: ipMatch[0],
      mac,
      hostname: hostname || undefined,
      interface: ifaceMatch ? ifaceMatch[1] : (currentInterface || undefined),
    });
  }
  return dedupe(out);
}

// Linux `ip neigh show` output:
//   192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
//   192.168.1.55 dev wlan0  FAILED
//
// We skip rows without an lladdr (incomplete neighbor entries) and rows
// marked FAILED/INCOMPLETE since they don't represent a confirmed neighbor.
export function parseIpNeigh(stdout) {
  if (!stdout) return [];
  const out = [];
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const ipMatch = line.match(IPV4_RE);
    if (!ipMatch || !isUsableIp(ipMatch[0])) continue;
    const stateMatch = /\b(REACHABLE|STALE|DELAY|PROBE|PERMANENT|NOARP)\b/.exec(line);
    if (!stateMatch && /\b(FAILED|INCOMPLETE)\b/.test(line)) continue;
    const macMatch = /\blladdr\s+([0-9a-fA-F:]+)/.exec(line);
    const mac = normalizeMac(macMatch && macMatch[1]);
    if (!isUsableMac(mac)) continue;
    const ifaceMatch = /\bdev\s+(\S+)/.exec(line);
    out.push({
      ip: ipMatch[0],
      mac,
      interface: ifaceMatch ? ifaceMatch[1] : undefined,
    });
  }
  return dedupe(out);
}

function dedupe(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = `${row.ip}|${row.mac || ''}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return Array.from(seen.values());
}

// ── Interface fingerprint for cache key ─────────────────────────────────────

function interfaceFingerprint(ifaceMap = networkInterfaces()) {
  // Use the set of (name, family, address) tuples to detect interface
  // changes (e.g. operator hops to a different network) so the cache
  // doesn't return stale results after a network change.
  const tuples = [];
  for (const [name, addrs] of Object.entries(ifaceMap || {})) {
    if (!Array.isArray(addrs)) continue;
    for (const a of addrs) {
      if (a.internal) continue;
      tuples.push(`${name}|${a.family}|${a.address}`);
    }
  }
  tuples.sort();
  return tuples.join(';') || 'no-interfaces';
}

// ── Platform dispatcher ─────────────────────────────────────────────────────

export function pickPlatformProbe(osPlatform = platform()) {
  if (osPlatform === 'linux') {
    return { kind: 'ip-neigh', file: 'ip', args: ['neigh', 'show'], parser: parseIpNeigh };
  }
  // win32 / darwin / others — `arp -a` is widely available and gives a
  // consistent enough text format for our parser.
  return { kind: 'arp-a', file: 'arp', args: ['-a'], parser: parseArpA };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Read the local ARP / neighbor table and return discovered neighbors.
 *
 * Options:
 *   execFile         — overrideable for tests (defaults to node child_process.execFile)
 *   osPlatform       — overrideable for tests (defaults to os.platform())
 *   ifaceMap         — overrideable for tests (defaults to os.networkInterfaces())
 *   now              — overrideable for tests (defaults to Date.now())
 *   force            — bypass the 60s cache
 *
 * Resolves to:
 *   { platform: 'linux|win32|darwin|…',
 *     probe: 'ip-neigh|arp-a',
 *     neighbors: Array<{ ip, mac, hostname?, vendor?, interface }>,
 *     cached: bool,
 *     generatedAt: ISO string }
 */
export async function discoverLocalNetwork(opts = {}) {
  const execFile = opts.execFile || nodeExecFile;
  const osPlatform = opts.osPlatform || platform();
  const ifaceMap = opts.ifaceMap || networkInterfaces();
  const now = typeof opts.now === 'function' ? opts.now() : (opts.now ?? nowMs());
  const fingerprint = interfaceFingerprint(ifaceMap);
  const force = opts.force === true;

  if (!force && _cache && _cache.fingerprint === fingerprint && (now - _cache.at) < CACHE_TTL_MS) {
    return { ...structuredClone(_cache.result), cached: true };
  }

  const probe = pickPlatformProbe(osPlatform);
  let stdout = '';
  let neighbors = [];
  try {
    stdout = await execFilePromise(execFile, probe.file, probe.args);
    neighbors = probe.parser(stdout);
  } catch (err) {
    // Tool missing or transient failure → return an empty result so the UI
    // can render a clean "no neighbors discovered" state. The error message
    // is included in the result so the route layer can surface it.
    const result = {
      platform: osPlatform,
      probe: probe.kind,
      neighbors: [],
      cached: false,
      generatedAt: new Date(now).toISOString(),
      error: String(err?.message || err),
    };
    _cache = { fingerprint, at: now, result };
    return { ...structuredClone(result) };
  }

  const result = {
    platform: osPlatform,
    probe: probe.kind,
    neighbors,
    cached: false,
    generatedAt: new Date(now).toISOString(),
  };
  _cache = { fingerprint, at: now, result };
  return { ...structuredClone(result) };
}

/** Test seam — wipe the 60s cache so a fresh fixture run is observable. */
export function _resetCache() { _cache = null; }

/** Test seam — inspect cache metadata. */
export function _peekCache() { return _cache ? { fingerprint: _cache.fingerprint, at: _cache.at } : null; }

// ── Markdown preview for the LLM ────────────────────────────────────────────

/**
 * Render a short markdown table preview of the neighbor list. Keeps row
 * count bounded so a noisy network doesn't blow out the agent's context.
 */
export function renderNeighborsMarkdown(neighbors = [], { limit = 20 } = {}) {
  if (!Array.isArray(neighbors) || neighbors.length === 0) {
    return '_No neighbors discovered in the local ARP / neighbor table._';
  }
  const rows = neighbors.slice(0, limit);
  const header = '| IP | MAC | Interface | Hostname |\n| --- | --- | --- | --- |';
  const body = rows.map((n) => {
    const ip = n.ip || '—';
    const mac = n.mac || '—';
    const iface = n.interface || '—';
    const host = n.hostname || '—';
    return `| ${ip} | ${mac} | ${iface} | ${host} |`;
  }).join('\n');
  const more = neighbors.length > limit
    ? `\n\n_+${neighbors.length - limit} more (truncated)_`
    : '';
  return `${header}\n${body}${more}`;
}
