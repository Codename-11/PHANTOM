#!/usr/bin/env node
/**
 * PHANTOM — local-dev demo seed
 *
 * Populates the SQLite database with realistic, authorized-testing-flavored
 * placeholder data so the UI has something to render on a fresh clone.
 *
 * CLI:
 *   npm run seed              # idempotent; bails if [demo] data already present
 *   npm run seed -- --reset   # wipe existing [demo] rows then reseed
 *
 * Programmatic (used by /api/onboarding/load-demo):
 *   import { runSeed, clearDemo, isDemoLoaded } from '../scripts/seed.js';
 *   runSeed({ reset: true });
 *
 * Every demo row is tagged with a `[demo]` name prefix or `metadata.demo=true`
 * so it's trivially identifiable. No production data is touched.
 */

import { fileURLToPath, pathToFileURL } from 'url';
import {
  initDB, getDB, createConversation, addMessage, createRun, addTraceEvent,
  createArtifact, completeRun, failRun,
} from '../server/memory/store.js';
import { createScope, getScopes, archiveScope } from '../server/scope/scope-store.js';
import { createAsset, getAssets, createFinding, createAssetSnapshot } from '../server/assets/asset-store.js';
import { createPromptProfile, createPromptFragment, getPromptProfiles } from '../server/prompts/prompt-store.js';

export const DEMO_TAG = '[demo]';

/**
 * Returns true if any [demo]-tagged scope is present in the DB.
 * Cheap — used by /api/onboarding/status.
 */
export function isDemoLoaded() {
  try {
    const rows = getScopes({ includeArchived: true }) || [];
    return rows.some((s) => s.name && s.name.startsWith(DEMO_TAG));
  } catch {
    return false;
  }
}

/**
 * Wipe every [demo]-tagged row across scopes/assets/runs/etc.
 * Returns a count map for the deletions performed.
 */
export function clearDemo() {
  const db = getDB();
  const demoScopeIds   = db.prepare(`SELECT id FROM scopes WHERE name LIKE '${DEMO_TAG}%'`).all().map(r => r.id);
  const demoAssetIds   = db.prepare(`SELECT id FROM assets WHERE name LIKE '${DEMO_TAG}%'`).all().map(r => r.id);
  const demoProfileIds = db.prepare(`SELECT id FROM prompt_profiles WHERE name LIKE '${DEMO_TAG}%'`).all().map(r => r.id);
  const demoConvIds    = db.prepare(`SELECT id FROM conversations WHERE title LIKE '${DEMO_TAG}%'`).all().map(r => r.id);

  const demoRunIds = demoConvIds.length
    ? db.prepare(`SELECT id FROM runs WHERE conversation_id IN (${demoConvIds.map(() => '?').join(',')})`).all(...demoConvIds).map(r => r.id)
    : [];

  const del = (sql, ids) => {
    if (!ids.length) return 0;
    const stmt = db.prepare(sql.replace('?LIST?', ids.map(() => '?').join(',')));
    return stmt.run(...ids).changes;
  };

  return {
    artifacts:        del(`DELETE FROM artifacts        WHERE run_id IN (?LIST?)`, demoRunIds),
    traceEvents:      del(`DELETE FROM trace_events     WHERE run_id IN (?LIST?)`, demoRunIds),
    runs:             del(`DELETE FROM runs             WHERE id IN (?LIST?)`, demoRunIds),
    messages:         del(`DELETE FROM messages         WHERE conversation_id IN (?LIST?)`, demoConvIds),
    conversations:    del(`DELETE FROM conversations    WHERE id IN (?LIST?)`, demoConvIds),
    findings:         del(`DELETE FROM findings         WHERE asset_id IN (?LIST?)`, demoAssetIds),
    assetSnapshots:   del(`DELETE FROM asset_snapshots  WHERE asset_id IN (?LIST?)`, demoAssetIds),
    assetTags:        del(`DELETE FROM asset_tags       WHERE asset_id IN (?LIST?)`, demoAssetIds),
    assetAddresses:   del(`DELETE FROM asset_addresses  WHERE asset_id IN (?LIST?)`, demoAssetIds),
    assetServices:    del(`DELETE FROM asset_services   WHERE asset_id IN (?LIST?)`, demoAssetIds),
    assets:           del(`DELETE FROM assets           WHERE id IN (?LIST?)`, demoAssetIds),
    promptFragments:  del(`DELETE FROM prompt_fragments WHERE profile_id IN (?LIST?)`, demoProfileIds),
    promptProfiles:   del(`DELETE FROM prompt_profiles  WHERE id IN (?LIST?)`, demoProfileIds),
    scopes:           del(`DELETE FROM scopes           WHERE id IN (?LIST?)`, demoScopeIds),
  };
}

/**
 * Populate the DB with the demo dataset. Idempotent: refuses to run
 * when demo data is already present unless `reset:true`.
 *
 * @param {object} opts
 * @param {boolean} [opts.reset=false]  Wipe existing demo rows first
 * @param {function} [opts.log]          Optional logger (default: silent)
 * @returns {{ scopes, assets, runs, conversations, findings, promptProfiles, cleared? }}
 */
export function runSeed({ reset = false, log = () => {} } = {}) {
  if (isDemoLoaded() && !reset) {
    throw new Error('Demo data already present. Call runSeed({reset:true}) to regenerate.');
  }

  let cleared = null;
  if (reset && isDemoLoaded()) {
    log('Reset: purging existing demo rows…');
    cleared = clearDemo();
  }

  log('Seeding demo data…');

  // ─── Scopes ─────────────────────────────────────────────────────────────────
  const scopeWebProd = createScope({
    name: `${DEMO_TAG} WEB-PROD-Q2`,
    targets: {
      domains: ['webapp.example.local', 'api.example.local'],
      cidrs:   ['10.0.0.0/24'],
      urls:    ['https://webapp.example.local/'],
    },
    allowedActions: ['read/local', 'recon', 'network-scan'],
    blockedActions: ['destructive', 'exploit', 'online-bruteforce'],
    notes: 'Q2 production web-app baseline. Read-only scans against the staging clone, never prod.',
  });

  const scopeLabRecon = createScope({
    name: `${DEMO_TAG} LAB-INTERNAL`,
    targets: { hosts: ['lab-windows10.local'], cidrs: ['192.168.50.0/24'] },
    allowedActions: ['recon', 'network-scan', 'read/local'],
    blockedActions: ['online-bruteforce', 'destructive'],
    notes: 'Internal lab segment — RFC1918 only. No internet-facing recon.',
  });

  const scopeCredAudit = createScope({
    name: `${DEMO_TAG} LEGACY-CRED-AUDIT`,
    targets: { hosts: ['ssh.legacy.local'] },
    allowedActions: ['offline-password-audit', 'credentialed'],
    blockedActions: ['online-bruteforce', 'exploit', 'destructive'],
    expiresAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Offline hash audit only. Expired — kept for replay/history.',
  });

  // ─── Assets ─────────────────────────────────────────────────────────────────
  const assetWebapp = createAsset({
    type: 'web-host', name: `${DEMO_TAG} webapp.example.local`,
    description: 'Customer-facing Q2 web application (staging clone).',
    owner: 'webteam@example.local', environment: 'staging', criticality: 'high',
    addresses: [{ kind: 'domain', value: 'webapp.example.local' }, { kind: 'ipv4', value: '10.0.0.21' }],
    services:  [{ name: 'https', port: 443, protocol: 'tcp' }, { name: 'http', port: 80, protocol: 'tcp' }],
    tags: ['demo', 'web', 'q2-baseline'],
  });
  const assetApi = createAsset({
    type: 'api-host', name: `${DEMO_TAG} api.example.local`,
    description: 'Public REST API gateway in front of internal microservices.',
    owner: 'platform@example.local', environment: 'staging', criticality: 'critical',
    addresses: [{ kind: 'domain', value: 'api.example.local' }, { kind: 'ipv4', value: '10.0.0.22' }],
    services:  [{ name: 'https', port: 443, protocol: 'tcp' }],
    tags: ['demo', 'api', 'q2-baseline'],
  });
  const assetDb = createAsset({
    type: 'database', name: `${DEMO_TAG} db-primary`,
    description: 'PostgreSQL 15 primary. Should NOT be reachable from internet.',
    owner: 'data@example.local', environment: 'staging', criticality: 'critical',
    addresses: [{ kind: 'ipv4', value: '10.0.0.50' }],
    services:  [{ name: 'postgres', port: 5432, protocol: 'tcp' }, { name: 'ssh', port: 22, protocol: 'tcp' }],
    tags: ['demo', 'database'],
  });
  const assetJump = createAsset({
    type: 'server', name: `${DEMO_TAG} internal-jumphost`,
    description: 'Bastion host for internal ops, hardened, MFA-only.',
    owner: 'secops@example.local', environment: 'internal', criticality: 'medium',
    addresses: [{ kind: 'ipv4', value: '192.168.50.10' }],
    services:  [{ name: 'ssh', port: 22, protocol: 'tcp' }],
    tags: ['demo', 'bastion'],
  });
  const assetLegacy = createAsset({
    type: 'vpn-gateway', name: `${DEMO_TAG} legacy-vpn`,
    description: 'End-of-life VPN concentrator. Scheduled for decommission next quarter.',
    owner: 'netops@example.local', environment: 'production', criticality: 'low',
    addresses: [{ kind: 'ipv4', value: '203.0.113.50' }],
    services:  [{ name: 'ipsec', port: 500, protocol: 'udp' }, { name: 'isakmp', port: 4500, protocol: 'udp' }],
    tags: ['demo', 'legacy', 'eol'],
  });
  const assetLabWin = createAsset({
    type: 'workstation', name: `${DEMO_TAG} lab-windows10`,
    description: 'Isolated Windows 10 lab box used for malware triage.',
    owner: 'redteam@example.local', environment: 'lab', criticality: 'low',
    addresses: [{ kind: 'ipv4', value: '192.168.50.45' }],
    services:  [{ name: 'smb', port: 445, protocol: 'tcp' }, { name: 'rdp', port: 3389, protocol: 'tcp' }],
    tags: ['demo', 'lab', 'workstation'],
  });

  // ─── Findings ───────────────────────────────────────────────────────────────
  const findings = [
    { assetId: assetWebapp.id, scopeId: scopeWebProd.id, title: 'TLS 1.0 accepted on 443', severity: 'medium', status: 'open',
      description: 'Server negotiates TLS 1.0 — fails PCI 4.0 requirement 4.2.1.', recommendation: 'Disable TLS 1.0 + 1.1 in the load-balancer config.' },
    { assetId: assetWebapp.id, scopeId: scopeWebProd.id, title: 'HSTS header missing', severity: 'low', status: 'open',
      description: 'Strict-Transport-Security not set on the public origin.', recommendation: 'Add HSTS with max-age=31536000; includeSubDomains.' },
    { assetId: assetApi.id, scopeId: scopeWebProd.id, title: 'No rate-limit on /v1/login', severity: 'high', status: 'open',
      description: 'Endpoint accepts 1000+ POST attempts/minute from one IP. Brute-force risk.', recommendation: 'Add a 10-req/min/IP throttle and account lockout after 5 failures.' },
    { assetId: assetDb.id, scopeId: scopeWebProd.id, title: 'SSH port reachable from staging segment', severity: 'critical', status: 'open',
      description: 'Port 22 on db-primary answers from the staging VLAN. Should be admin-VLAN-only.', recommendation: 'Tighten security group / ACL to admin VLAN sources only.' },
    { assetId: assetLegacy.id, title: 'Firmware behind on CVE-2024-23456', severity: 'high', status: 'open',
      description: 'Vendor advisory issued 2025-11; current firmware predates the fix.', recommendation: 'Schedule the EOL replacement window — patching this device is no longer supported.' },
    { assetId: assetJump.id, scopeId: scopeLabRecon.id, title: 'SSH banner reveals OS version', severity: 'info', status: 'open',
      description: '`SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.4` exposes the patch level.', recommendation: 'Set `DebianBanner no` in sshd_config.' },
    { assetId: assetLabWin.id, scopeId: scopeLabRecon.id, title: 'SMBv1 enabled', severity: 'medium', status: 'open',
      description: 'Lab image still has SMBv1 enabled; safe inside the lab but should be off for hygiene.', recommendation: 'Disable via `Disable-WindowsOptionalFeature -Online -FeatureName smb1protocol`.' },
  ];
  for (const f of findings) createFinding(f);

  createAssetSnapshot({
    assetId: assetWebapp.id, scopeId: scopeWebProd.id, title: 'Baseline · Q2 web-app',
    status: 'reviewed', healthScore: 78, summary: 'Two open issues, both non-blocking. Cleared for Q2 release.',
    findingCounts: { critical: 0, high: 0, medium: 1, low: 1 },
  });
  createAssetSnapshot({
    assetId: assetApi.id, scopeId: scopeWebProd.id, title: 'Baseline · API gateway',
    status: 'attention', healthScore: 62, summary: 'Rate-limit gap on /v1/login is the only blocker. Mitigation deployed to staging.',
    findingCounts: { critical: 0, high: 1, medium: 0, low: 0 },
  });

  const profile = createPromptProfile({
    name: `${DEMO_TAG} Cautious Recon`,
    description: 'Read-only / passive posture. Refuses to escalate without explicit operator approval.',
    mode: 'recon',
  });
  createPromptFragment({ profileId: profile.id, kind: 'system', name: 'Posture', body: 'Operate in read-only mode. If an action could change state on a target, stop and ask.', position: 10 });
  createPromptFragment({ profileId: profile.id, kind: 'policy', name: 'Scope check', body: 'Before any tool call that hits the network, restate the active scope and confirm the target is in-scope.', position: 20 });
  createPromptFragment({ profileId: profile.id, kind: 'output', name: 'Evidence form', body: 'Cite tool outputs verbatim and note timestamps. Never summarize raw responses without flagging.', position: 30 });

  function seedRun({ convTitle, runTitle, goal, scopeId, riskLevel, traceEvents, terminal = 'completed', summary, model = 'gpt-4o', userMsg, aiMsg, artifacts = [] }) {
    const conv = createConversation(`${DEMO_TAG} ${convTitle}`);
    if (userMsg) addMessage(conv.id, { role: 'user', content: userMsg });
    if (aiMsg)   addMessage(conv.id, { role: 'assistant', content: aiMsg });
    const run = createRun({
      conversationId: conv.id, title: runTitle, goal, model, providerRoute: 'openai',
      scopeId, riskLevel,
      promptSnapshot: { profileId: profile.id, profileName: profile.name, basePrompt: '<redacted>' },
    });
    for (const ev of traceEvents) addTraceEvent(run.id, ev);
    for (const a of artifacts) createArtifact({ runId: run.id, conversationId: conv.id, ...a });
    if (terminal === 'completed') completeRun(run.id, summary);
    else if (terminal === 'failed') failRun(run.id, summary);
    return { conv, run };
  }

  seedRun({
    convTitle: 'Q2 web app baseline',
    runTitle:  'Web baseline · webapp.example.local',
    goal: 'Confirm TLS hygiene, HSTS, and rate-limiting on the Q2 staging clone before release.',
    scopeId: scopeWebProd.id, riskLevel: 'low',
    userMsg: "Run the standard pre-release recon on webapp.example.local and api.example.local. Read-only, scope WEB-PROD-Q2.",
    aiMsg:   "Acknowledged. Targeting WEB-PROD-Q2 in read-only mode. Starting with TLS and header checks, then a passive scan of exposed endpoints.",
    traceEvents: [
      { type: 'run.started', phase: 'init', status: 'completed', metadata: { scope: 'WEB-PROD-Q2' } },
      { type: 'prompt.compose', phase: 'init', status: 'completed', metadata: { profile: '[demo] Cautious Recon' } },
      { type: 'tool.call', phase: 'recon', status: 'completed', toolName: 'tls_probe',
        input: { host: 'webapp.example.local', port: 443 },
        outputPreview: 'Protocols offered: TLSv1.0 TLSv1.1 TLSv1.2 TLSv1.3. Cert OK.' },
      { type: 'tool.call', phase: 'recon', status: 'completed', toolName: 'http_headers',
        input: { url: 'https://webapp.example.local/' },
        outputPreview: 'Strict-Transport-Security: <missing>\nX-Frame-Options: SAMEORIGIN' },
      { type: 'finding.recorded', phase: 'analysis', status: 'completed', metadata: { severity: 'medium', title: 'TLS 1.0 accepted on 443' } },
      { type: 'finding.recorded', phase: 'analysis', status: 'completed', metadata: { severity: 'low', title: 'HSTS header missing' } },
      { type: 'run.completed', phase: 'finalize', status: 'completed' },
    ],
    summary: '2 findings (1 medium, 1 low). Web app cleared for release subject to TLS 1.0 disablement.',
    artifacts: [
      { type: 'report', title: 'Q2 web baseline report', mimeType: 'text/markdown',
        path: 'workspace/demo/q2-web-baseline.md', metadata: { demo: true } },
    ],
  });

  seedRun({
    convTitle: 'Lab recon dry-run',
    runTitle:  'Lab segment sweep · 192.168.50.0/24',
    goal: 'Map the lab segment and inventory services. Stay strictly inside RFC1918.',
    scopeId: scopeLabRecon.id, riskLevel: 'medium',
    userMsg: "Inventory the lab segment. Don't try anything credential-related, this is a discovery pass.",
    aiMsg:   "Got it — discovery only. Pulling ARP + nmap sweep on 192.168.50.0/24 and recording open services. Will block on any action class outside `recon` / `network-scan`.",
    traceEvents: [
      { type: 'run.started', phase: 'init', status: 'completed' },
      { type: 'tool.call', phase: 'recon', status: 'completed', toolName: 'nmap_scan',
        input: { target: '192.168.50.0/24', flags: ['-sn'] },
        outputPreview: '12 hosts up; details in artifact.' },
      { type: 'tool.call', phase: 'recon', status: 'completed', toolName: 'service_enum',
        input: { target: '192.168.50.45', ports: [445, 3389] },
        outputPreview: 'SMB enabled (smb1 advertised), RDP open.' },
      { type: 'policy.block', phase: 'gate', status: 'blocked', toolName: 'hydra_login',
        input: { target: '192.168.50.45', service: 'smb', wordlist: 'rockyou.txt' },
        metadata: { reason: 'online-bruteforce blocked by scope', decision: 'denied', scopeAction: 'online-bruteforce' } },
      { type: 'finding.recorded', phase: 'analysis', status: 'completed', metadata: { severity: 'medium', title: 'SMBv1 enabled' } },
      { type: 'finding.recorded', phase: 'analysis', status: 'completed', metadata: { severity: 'info', title: 'SSH banner reveals OS version' } },
      { type: 'run.completed', phase: 'finalize', status: 'completed' },
    ],
    summary: 'Lab inventory complete. One brute-force attempt blocked by scope policy as expected.',
    artifacts: [
      { type: 'inventory', title: 'Lab segment inventory (CSV)', mimeType: 'text/csv',
        path: 'workspace/demo/lab-inventory.csv', metadata: { demo: true } },
      { type: 'summary', title: 'Lab sweep summary', mimeType: 'text/markdown',
        path: 'workspace/demo/lab-sweep.md', metadata: { demo: true } },
    ],
  });

  seedRun({
    convTitle: 'Legacy creds audit',
    runTitle:  'Offline hash audit · ssh.legacy.local',
    goal: 'Hash-only password audit against the legacy bastion list.',
    scopeId: scopeCredAudit.id, riskLevel: 'high',
    userMsg: "We have the hash dump from the legacy bastion. Run the offline audit per LEGACY-CRED-AUDIT scope.",
    aiMsg:   "Scope LEGACY-CRED-AUDIT is expired (7 days past). Policy blocks the run until you either renew the scope or explicitly override. Halting.",
    traceEvents: [
      { type: 'run.started', phase: 'init', status: 'completed' },
      { type: 'policy.block', phase: 'gate', status: 'blocked',
        metadata: { reason: 'scope expired', decision: 'denied', scopeName: '[demo] LEGACY-CRED-AUDIT' } },
      { type: 'run.failed', phase: 'finalize', status: 'failed' },
    ],
    terminal: 'failed',
    summary: 'Halted by scope-expired policy gate. Renew the scope or run with operator override.',
  });

  seedRun({
    convTitle: 'Active web vuln assessment',
    runTitle:  'Active vuln sweep · api.example.local',
    goal: 'Deep authenticated probe of /v1/* endpoints to validate the new rate-limit + RBAC fix.',
    scopeId: scopeWebProd.id, riskLevel: 'medium',
    userMsg: "Run the post-fix vuln assessment on api.example.local — focus on /v1/login throttling and IDOR on /v1/users.",
    aiMsg:   "Starting now. I'll cycle TLS/header verification, then rate-limit probing, then auth/IDOR fuzz. Will surface anything that bypasses the new throttle.",
    traceEvents: [
      { type: 'run.started', phase: 'init', status: 'completed', metadata: { scope: 'WEB-PROD-Q2' } },
      { type: 'prompt.compose', phase: 'init', status: 'completed' },
      { type: 'tool.call', phase: 'recon', status: 'completed', toolName: 'tls_probe',
        input: { host: 'api.example.local', port: 443 },
        outputPreview: 'TLS 1.2 + 1.3 only. HSTS present (max-age=31536000). Cert valid 88d.' },
      { type: 'tool.call', phase: 'recon', status: 'completed', toolName: 'http_headers',
        input: { url: 'https://api.example.local/v1' },
        outputPreview: 'Server: nginx\nX-Frame-Options: DENY\nContent-Security-Policy: default-src \'self\'' },
      { type: 'tool.call', phase: 'analysis', status: 'completed', toolName: 'rate_limit_probe',
        input: { url: 'https://api.example.local/v1/login', burst: 30, window_s: 10 },
        outputPreview: 'Burst 30 in 10s → 11 accepted, 19 throttled with 429. New limit holds.' },
      { type: 'tool.call', phase: 'analysis', status: 'started', toolName: 'idor_fuzz',
        input: { url: 'https://api.example.local/v1/users/{id}', technique: 'parameter-mutation' },
        outputPreview: 'Cycling /v1/users/{1..2000} — 7.3% completed…' },
    ],
    terminal: 'running',
    artifacts: [
      { type: 'evidence', title: 'Rate-limit probe burst log', mimeType: 'application/json',
        path: 'workspace/demo/api-rate-limit-burst.json', metadata: { demo: true } },
    ],
  });

  // Add evidence + report artifacts to existing runs for richer Artifacts page coverage
  {
    const db = getDB();
    const labRunRow = db.prepare(`SELECT id, conversation_id FROM runs WHERE title LIKE 'Lab segment sweep%' LIMIT 1`).get();
    if (labRunRow) {
      createArtifact({ runId: labRunRow.id, conversationId: labRunRow.conversation_id,
        type: 'evidence', title: 'nmap raw scan output (XML)', mimeType: 'application/xml',
        path: 'workspace/demo/lab-nmap.xml', metadata: { demo: true } });
    }
    const webRunRow = db.prepare(`SELECT id, conversation_id FROM runs WHERE title LIKE 'Web baseline%' LIMIT 1`).get();
    if (webRunRow) {
      createArtifact({ runId: webRunRow.id, conversationId: webRunRow.conversation_id,
        type: 'evidence', title: 'TLS handshake transcripts', mimeType: 'text/plain',
        path: 'workspace/demo/q2-tls-transcripts.txt', metadata: { demo: true } });
      createArtifact({ runId: webRunRow.id, conversationId: webRunRow.conversation_id,
        type: 'summary', title: 'Q2 web exec summary', mimeType: 'text/markdown',
        path: 'workspace/demo/q2-exec-summary.md', metadata: { demo: true } });
    }
  }

  const profileAggressive = createPromptProfile({
    name: `${DEMO_TAG} Active Probe`,
    description: 'Active scanning posture. Allows authenticated probes inside an active scope. Loud by design.',
    mode: 'vuln-assessment',
  });
  createPromptFragment({ profileId: profileAggressive.id, kind: 'system', name: 'Posture', body: 'Operate in active probe mode. Tools may write request payloads against in-scope targets only.', position: 10 });
  createPromptFragment({ profileId: profileAggressive.id, kind: 'output', name: 'Rate limits', body: 'Throttle every probe to ≤ 10 rps per host and pause on any 5xx burst.', position: 20 });

  log('Demo seed complete.');

  return {
    scopes: [scopeWebProd.id, scopeLabRecon.id, scopeCredAudit.id],
    assets: [assetWebapp.id, assetApi.id, assetDb.id, assetJump.id, assetLegacy.id, assetLabWin.id],
    promptProfiles: [profile.id, profileAggressive.id],
    findingCount: findings.length,
    cleared,
  };
}

// ── CLI invocation (only when run directly) ─────────────────────────────────
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  initDB();
  const reset = process.argv.includes('--reset');
  try {
    const result = runSeed({ reset, log: (msg) => console.log(`◆ ${msg}`) });
    console.log(`  ✓ ${result.scopes.length} scopes`);
    console.log(`  ✓ ${result.assets.length} assets`);
    console.log(`  ✓ ${result.findingCount} findings`);
    console.log(`  ✓ ${result.promptProfiles.length} prompt profiles`);
    if (result.cleared) {
      const totalDeleted = Object.values(result.cleared).reduce((a, b) => a + b, 0);
      console.log(`  ✓ ${totalDeleted} demo rows purged before reseed`);
    }
    console.log('\nOpen http://localhost:5173 — Runs / Assets / Scope / Artifacts pages all populated.');
  } catch (err) {
    console.error(`✕ ${err.message}`);
    process.exit(1);
  }
}
