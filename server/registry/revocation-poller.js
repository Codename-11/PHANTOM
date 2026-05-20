// Revocation poller (B4-full).
//
// Periodically polls every enabled registry source's revocations feed.
// Caches the parsed entries in-process so the manifest-install path can
// query "is package X@Y revoked?" without hitting the network on every
// check.
//
// Lifecycle:
//   - server/index.js calls `startRevocationPoller()` once at boot.
//   - The poller runs once immediately, then on `POLL_INTERVAL_MS`.
//   - `stopRevocationPoller()` is exposed for tests + graceful shutdown.
//
// The poller is FAIL-SAFE: an unreachable source / invalid signature
// does NOT crash the process — outcomes are recorded via
// recordFetchOutcome(). A previously-cached feed for a now-failing
// source stays in the cache (stale-cache warning is the operator's
// signal to investigate).

import { listRegistrySources, recordFetchOutcome } from './registry-source-store.js';
import { fetchRevocations } from './remote-fetch.js';

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const _cache = new Map(); // sourceId → { entries, byPackage, generatedAt, signatureStatus, fetchedAt }
let _timer = null;
let _running = false;

/**
 * Run a single poll pass across every enabled source. Resolves when
 * all sources have been processed (success or recorded failure).
 * Exposed for tests + an operator-driven /poll-now route.
 */
export async function pollOnce({ now = () => Date.now() } = {}) {
  const sources = listRegistrySources({ enabledOnly: true });
  const results = [];
  for (const source of sources) {
    const r = await fetchRevocations(source);
    if (r.ok) {
      _cache.set(source.id, {
        entries: r.parsed?.entries || [],
        byPackage: r.parsed?.byPackage || new Map(),
        generatedAt: r.parsed?.generatedAt || null,
        signatureStatus: r.signatureStatus,
        fetchedAt: now(),
      });
      recordFetchOutcome(source.id, { status: 'ok' });
      results.push({ sourceId: source.id, status: 'ok', entryCount: r.parsed?.entries?.length || 0 });
    } else {
      const errStr = r.errors?.map((e) => e.message).join('; ') || 'unknown';
      const status = r.signatureStatus?.status === 'invalid' ? 'invalid_signature' : 'unreachable';
      recordFetchOutcome(source.id, { status, error: errStr });
      results.push({ sourceId: source.id, status, error: errStr });
    }
  }
  return results;
}

/**
 * Check whether a package@version is revoked according to any cached
 * feed. Returns the highest-severity match across all sources.
 *
 * @returns {{ status: 'ok' | 'warn' | 'block', sourceId?, entry?, replacement?, reason? }}
 */
export function checkRevoked(packageId, version) {
  let worst = { status: 'ok' };
  for (const [sourceId, entry] of _cache.entries()) {
    const entries = entry.byPackage.get(packageId);
    if (!entries?.length) continue;
    for (const e of entries) {
      if (!e.versions.includes(version)) continue;
      if (e.severity === 'block') {
        return { status: 'block', sourceId, entry: e, replacement: e.replacement || null, reason: e.reason };
      }
      if (e.severity === 'warn' && worst.status === 'ok') {
        worst = { status: 'warn', sourceId, entry: e, replacement: e.replacement || null, reason: e.reason };
      }
    }
  }
  return worst;
}

/**
 * Roll-up of cached feeds — used by /api/registry/revocations + the
 * diagnostics check.
 */
export function getRevocationSummary() {
  let total = 0;
  let warn = 0;
  let block = 0;
  for (const entry of _cache.values()) {
    for (const e of entry.entries) {
      total += 1;
      if (e.severity === 'warn') warn += 1;
      else if (e.severity === 'block') block += 1;
    }
  }
  return {
    sources: _cache.size,
    entries: total,
    warn,
    block,
  };
}

/** Flat list of revocations across all sources — for the UI. */
export function listCachedRevocations() {
  const out = [];
  for (const [sourceId, entry] of _cache.entries()) {
    for (const e of entry.entries) {
      out.push({ sourceId, ...e });
    }
  }
  return out;
}

export function startRevocationPoller({ intervalMs = POLL_INTERVAL_MS } = {}) {
  if (_running) return; // idempotent
  _running = true;
  // First poll fires immediately so the cache is populated on boot.
  // Failures here are fail-safe — the timer keeps running.
  pollOnce().catch(() => {});
  _timer = setInterval(() => {
    pollOnce().catch(() => {});
  }, intervalMs);
  // unref so the timer doesn't keep the process alive under
  // `node --test` / graceful-shutdown scenarios.
  _timer.unref?.();
}

export function stopRevocationPoller() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _running = false;
}

/** Test-only — clears the in-process cache. */
export function _resetCache() { _cache.clear(); }
