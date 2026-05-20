// PHANTOM diagnostics — bounded per-check readiness probe.
//
// Every check has its own ≤500ms timeout via Promise.race. The composite
// route returns within 1500ms even if all checks time out. Secrets are
// redacted before any value leaves this module (api key shown as
// ••••<last4>, sudo password values never returned).
//
// Status aggregation:
//   ok / configured / reachable / installed → "ok"
//   missing / misconfigured                  → "needs_setup"
//   degraded / unreachable / partial        → "degraded"
//   blocked / error                          → "blocked"
//
// Overall status = the worst component status.

import os from 'os';
import { existsSync, statSync, accessSync, constants as fsConstants } from 'fs';
import { getDB, getSetting } from '../memory/store.js';
import { getToolpacks, checkToolpackAvailability } from '../toolpacks/toolpack-registry.js';
import { listCampaigns } from '../campaigns/campaign-store.js';
import { getLocalManifestSummary } from '../registry/local-manifest-loader.js';
import config from '../config.js';

const PER_CHECK_TIMEOUT_MS = 500;
const TOTAL_BUDGET_MS = 1500;

const STATUS_RANK = {
  ok: 0,
  needs_setup: 1,
  degraded: 2,
  blocked: 3,
};

function worstStatus(statuses) {
  let worst = 'ok';
  for (const s of statuses) {
    if ((STATUS_RANK[s] ?? 0) > (STATUS_RANK[worst] ?? 0)) worst = s;
  }
  return worst;
}

// Redaction: never let secrets leave this module.
function redactKey(key) {
  if (!key) return null;
  const s = String(key);
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

// Bounded check wrapper — every check resolves with { status, elapsedMs, detail? }
// even on timeout/throw.
async function runCheck(id, fn) {
  const started = Date.now();
  let timeoutHandle;
  try {
    const result = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ status: 'degraded', detail: `timed out >${PER_CHECK_TIMEOUT_MS}ms` }), PER_CHECK_TIMEOUT_MS);
      }),
    ]);
    return { id, ...result, elapsedMs: Date.now() - started };
  } catch (err) {
    return { id, status: 'blocked', detail: String(err.message || err), elapsedMs: Date.now() - started };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

// ── Individual checks ────────────────────────────────────────────────────

function checkRuntime() {
  const inDocker = existsSync('/.dockerenv') || process.env.PHANTOM_IN_CONTAINER === '1';
  const mode = inDocker ? 'docker' : 'native';
  let elevation = 'user';
  if (process.platform === 'win32') {
    elevation = 'admin'; // Windows — UAC per-command
  } else if (process.getuid && process.getuid() === 0) {
    elevation = 'root';
  } else if (getSetting('sudo_password', '')) {
    elevation = 'sudo';
  }
  return {
    status: 'ok',
    detail: `${mode} · ${elevation} · ${process.platform} · node ${process.versions.node}`,
    data: { mode, elevation, platform: process.platform, nodeVersion: process.versions.node },
  };
}

function checkDB() {
  try {
    const db = getDB();
    db.prepare('SELECT 1').get();
    // Check the DB path is on a writable surface
    const dbPath = config.db.path;
    let writable = false;
    try {
      accessSync(dbPath, fsConstants.W_OK);
      writable = true;
    } catch { writable = false; }
    return {
      status: writable ? 'ok' : 'degraded',
      detail: writable ? `sqlite ok · ${dbPath}` : `sqlite ok but path not writable · ${dbPath}`,
      data: { path: dbPath, writable },
    };
  } catch (err) {
    return { status: 'blocked', detail: `sqlite open failed: ${err.message}` };
  }
}

function checkWorkspace() {
  const wsPath = config.workspace;
  if (!existsSync(wsPath)) {
    return { status: 'needs_setup', detail: `workspace missing · ${wsPath}`, data: { path: wsPath } };
  }
  try {
    const stat = statSync(wsPath);
    if (!stat.isDirectory()) {
      return { status: 'blocked', detail: `workspace path is not a directory · ${wsPath}` };
    }
    accessSync(wsPath, fsConstants.W_OK);
    return { status: 'ok', detail: `writable · ${wsPath}`, data: { path: wsPath } };
  } catch (err) {
    return { status: 'degraded', detail: `workspace unwritable: ${err.message}`, data: { path: wsPath } };
  }
}

function checkProvider() {
  const provider = config.api.provider;
  const baseUrl = config.api.baseUrl;
  const apiKey = config.api.apiKey;
  if (!provider || !baseUrl) {
    return { status: 'needs_setup', detail: 'provider not configured' };
  }
  if (!apiKey) {
    return {
      status: 'needs_setup',
      detail: `${provider} · ${baseUrl} · no api key`,
      data: { provider, baseUrl, hasApiKey: false, apiKeyPreview: null },
    };
  }
  return {
    status: 'ok',
    detail: `${provider} configured · ${baseUrl}`,
    data: { provider, baseUrl, hasApiKey: true, apiKeyPreview: redactKey(apiKey) },
  };
}

function checkDocs() {
  const docsDistIndex = `${process.cwd()}/user-docs/.vitepress/dist/index.html`;
  const altPath = `${config.root || process.cwd()}/user-docs/.vitepress/dist/index.html`;
  const enabled = getSetting('docs_enabled', '1') === '1';
  const built = existsSync(docsDistIndex) || existsSync(altPath);
  if (!enabled) return { status: 'ok', detail: 'docs disabled by setting', data: { enabled, built } };
  if (!built) return { status: 'needs_setup', detail: 'docs enabled but not built (npm run build:docs)', data: { enabled, built: false } };
  return { status: 'ok', detail: 'docs built + enabled', data: { enabled: true, built: true } };
}

function checkToolpacks() {
  try {
    const all = getToolpacks();
    let availableCount = 0;
    for (const pack of all) {
      try {
        const avail = checkToolpackAvailability(pack.id);
        if (avail.available || avail.partial) availableCount += 1;
      } catch { /* skip */ }
    }
    const totalCount = all.length;
    const status = totalCount === 0 ? 'needs_setup'
      : availableCount === 0 ? 'needs_setup'
      : availableCount < totalCount ? 'degraded'
      : 'ok';
    return {
      status,
      detail: `${availableCount} / ${totalCount} toolpacks available`,
      data: { totalCount, availableCount },
    };
  } catch (err) {
    return { status: 'degraded', detail: `toolpack probe failed: ${err.message}` };
  }
}

// B1 (continued) — Manifest parity check.
// Async because the parity helper dynamic-imports the manifest loader.
// Reports degraded when the JS registry and manifest world disagree
// (manifest missing or invalid for ≥1 toolpack).
async function checkToolpackParity() {
  try {
    const mod = await import('../toolpacks/toolpack-registry.js');
    const packs = await mod.getToolpacksWithManifestStatus();
    const ok = packs.filter((p) => p.parity.status === 'ok').length;
    const missing = packs.filter((p) => p.parity.status === 'manifest_missing').length;
    const invalid = packs.filter((p) => p.parity.status === 'manifest_invalid').length;
    const status = invalid > 0 ? 'degraded'
      : missing > 0 ? 'needs_setup'
      : 'ok';
    return {
      status,
      detail: invalid
        ? `${invalid} manifest(s) failed validation, ${missing} missing`
        : missing
          ? `${missing} of ${packs.length} toolpacks have no manifest fixture yet`
          : `${ok} of ${packs.length} toolpacks have valid manifests`,
      data: { total: packs.length, ok, missing, invalid },
    };
  } catch (err) {
    return { status: 'degraded', detail: `parity probe failed: ${err.message}` };
  }
}

function checkCampaigns() {
  try {
    const all = listCampaigns();
    const active = all.filter((c) => c.status === 'running').length;
    const draft = all.filter((c) => c.status === 'draft').length;
    return {
      status: 'ok',
      detail: `${all.length} total · ${active} running · ${draft} draft`,
      data: { totalCount: all.length, activeCount: active, draftCount: draft },
    };
  } catch (err) {
    return { status: 'degraded', detail: `campaign store unreachable: ${err.message}` };
  }
}

async function checkRevocations() {
  try {
    const mod = await import('../registry/revocation-poller.js');
    const s = mod.getRevocationSummary();
    if (s.sources === 0) {
      return { status: 'ok', detail: 'no registry sources configured', data: s };
    }
    if (s.block > 0) {
      return { status: 'degraded', detail: `${s.block} package version(s) BLOCKED by revocation feeds`, data: s };
    }
    if (s.warn > 0) {
      return { status: 'needs_setup', detail: `${s.warn} package version(s) carry warn revocations`, data: s };
    }
    return { status: 'ok', detail: `${s.sources} feed(s) clean`, data: s };
  } catch (err) {
    return { status: 'degraded', detail: `revocation poll: ${err.message}` };
  }
}

function checkRegistry() {
  try {
    const s = getLocalManifestSummary();
    const status = s.total === 0 ? 'needs_setup'
      : s.invalid > 0 ? 'degraded'
      : 'ok';
    return {
      status,
      detail: s.invalid
        ? `${s.invalid} of ${s.total} local manifests failed validation: ${s.invalidIds.join(', ')}`
        : `${s.valid} local manifests loaded + validated`,
      data: s,
    };
  } catch (err) {
    return { status: 'degraded', detail: `manifest loader unreachable: ${err.message}` };
  }
}

// ── Composite ────────────────────────────────────────────────────────────

export async function getDiagnostics() {
  const started = Date.now();
  // All checks fire in parallel; each is independently bounded.
  const checks = await Promise.race([
    Promise.all([
      runCheck('runtime',   checkRuntime),
      runCheck('db',        checkDB),
      runCheck('workspace', checkWorkspace),
      runCheck('provider',  checkProvider),
      runCheck('docs',      checkDocs),
      runCheck('toolpacks', checkToolpacks),
      runCheck('campaigns', checkCampaigns),
      runCheck('registry',  checkRegistry),
      runCheck('parity',    checkToolpackParity),
      runCheck('revocations', checkRevocations),
    ]),
    new Promise((resolve) => setTimeout(() => resolve([
      { id: '__budget__', status: 'degraded', detail: `total budget ${TOTAL_BUDGET_MS}ms exceeded`, elapsedMs: TOTAL_BUDGET_MS },
    ]), TOTAL_BUDGET_MS)),
  ]);

  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  const overall = worstStatus(checks.map((c) => c.status));

  return {
    overall,
    runtime:   byId.runtime?.data || null,
    db:        byId.db?.data || null,
    workspace: byId.workspace?.data || null,
    provider:  byId.provider?.data || null,
    docs:      byId.docs?.data || null,
    toolpacks: byId.toolpacks?.data || null,
    campaigns: byId.campaigns?.data || null,
    registry:  byId.registry?.data || null,
    parity:    byId.parity?.data || null,
    revocations: byId.revocations?.data || null,
    checks: checks.map(({ id, status, elapsedMs, detail }) => ({ id, status, elapsedMs, detail })),
    elapsedMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };
}

// Test seam — exposed so tests can override one check to simulate
// timeout / failure without monkey-patching the underlying modules.
export const _internals = {
  PER_CHECK_TIMEOUT_MS,
  TOTAL_BUDGET_MS,
  runCheck,
  worstStatus,
  redactKey,
};
