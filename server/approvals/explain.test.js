// server/approvals/explain.test.js
//
// Covers the pure explain() formatter for all 4 approval types
// (scope/install/registry/elevated), side-effect derivation, raw-details
// preservation, and the high|crit denial-reason gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  explain,
  detectApprovalType,
  requiresDenialReason,
  HIGH_RISK_CLASSES,
} from './explain.js';

// ─── Type detection ──────────────────────────────────────────────────────
test('detectApprovalType respects explicit type', () => {
  assert.equal(detectApprovalType({ type: 'scope' }), 'scope');
  assert.equal(detectApprovalType({ type: 'install' }), 'install');
  assert.equal(detectApprovalType({ type: 'registry' }), 'registry');
  assert.equal(detectApprovalType({ type: 'elevated' }), 'elevated');
});

test('detectApprovalType structurally detects install via plan[]', () => {
  const rec = { plan: [{ backend: 'apt', command: 'apt-get' }], toolIds: ['nmap'] };
  assert.equal(detectApprovalType(rec), 'install');
});

test('detectApprovalType structurally detects registry via packageId', () => {
  const rec = { packageId: 'web-recon', version: '1.0.0' };
  assert.equal(detectApprovalType(rec), 'registry');
});

test('detectApprovalType structurally detects elevated via requiresElevation', () => {
  const rec = { requiresElevation: true, command: 'sudo apt-get update' };
  assert.equal(detectApprovalType(rec), 'elevated');
});

test('detectApprovalType defaults to scope for trace-derived rows', () => {
  const rec = { toolName: 'web_request', args: { url: 'https://example.com' } };
  assert.equal(detectApprovalType(rec), 'scope');
});

// ─── Scope-type explanation ──────────────────────────────────────────────
test('explain(scope/web_request) yields readable target + risk + reason', () => {
  const raw = {
    id: 'evt_001',
    type: 'scope',
    toolName: 'web_request',
    args: { url: 'https://example.com/login' },
    risk: 'recon',
    kind: 'ask',
    decision: 'granted',
    occurredAt: '2026-05-20T12:00:00Z',
  };
  const out = explain(raw);
  assert.equal(out.id, 'evt_001');
  assert.equal(out.type, 'scope');
  assert.equal(out.target, 'example.com');
  assert.equal(out.riskClass, 'recon');
  assert.equal(out.actionClass, 'tool.web_request');
  assert.match(out.policyReason, /approval/i);
  assert.match(out.expectedEffect, /web_request/);
  assert.ok(out.sideEffects.includes('Writes 1 trace event to the run timeline.'));
  assert.ok(out.sideEffects.some(s => /example\.com/.test(s)));
  assert.equal(out.status, 'approved');
  assert.equal(out.denialReason, null);
  assert.equal(out.createdAt, '2026-05-20T12:00:00Z');
});

test('explain(scope/network-scan) derives high-risk side effects', () => {
  const raw = {
    id: 'evt_002',
    type: 'scope',
    toolName: 'execute_command',
    args: { command: 'nmap -sS 10.0.0.0/24' },
    risk: 'network-scan',
    kind: 'ask',
    decision: 'pending',
  };
  const out = explain(raw);
  assert.equal(out.riskClass, 'network-scan');
  assert.equal(out.status, 'pending');
  assert.ok(
    out.sideEffects.some(s => /IDS|IPS|probe/i.test(s)),
    'network-scan should mention defensive controls in side effects',
  );
});

test('explain(scope/destructive) flags filesystem mutation', () => {
  const raw = {
    type: 'scope',
    toolName: 'execute_command',
    args: { command: 'rm -rf /tmp/data' },
    risk: 'destructive',
    decision: 'denied',
    denialReason: 'never delete prod data',
  };
  const out = explain(raw);
  assert.equal(out.riskClass, 'destructive');
  assert.equal(out.status, 'denied');
  assert.equal(out.denialReason, 'never delete prod data');
  assert.ok(out.sideEffects.some(s => /modify|delete/i.test(s)));
});

// ─── Install-type explanation ────────────────────────────────────────────
test('explain(install) derives backend, expected effect, and side effects', () => {
  const raw = {
    id: 'inst_001',
    status: 'pending',
    toolIds: ['nmap', 'ffuf'],
    plan: [
      { id: 'nmap', backend: 'apt', command: 'apt-get', args: ['install', '-y', 'nmap'] },
      { id: 'ffuf', backend: 'apt', command: 'apt-get', args: ['install', '-y', 'ffuf'] },
    ],
    requested_at: '2026-05-20T13:00:00Z',
  };
  const out = explain(raw);
  assert.equal(out.type, 'install');
  assert.equal(out.target, 'packages:nmap,ffuf');
  assert.equal(out.actionClass, 'install.apt');
  assert.equal(out.riskClass, 'credentialed');
  assert.match(out.policyReason, /apt/);
  assert.match(out.expectedEffect, /2 security tools/);
  assert.ok(out.sideEffects.some(s => /elevated/i.test(s)));
  assert.ok(out.sideEffects.some(s => /package manager/i.test(s)));
  assert.equal(out.status, 'pending');
  assert.equal(out.createdAt, '2026-05-20T13:00:00Z');
});

test('explain(install) handles skipped entries', () => {
  const raw = {
    id: 'inst_002',
    status: 'pending',
    toolIds: ['nmap', 'unknownpkg'],
    plan: [
      { id: 'nmap', backend: 'apt', command: 'apt-get', args: [] },
      { id: 'unknownpkg', backend: null, command: null, reason: 'no package available' },
    ],
  };
  const out = explain(raw);
  assert.match(out.expectedEffect, /1 security tool/);
  assert.match(out.expectedEffect, /1 skipped/);
});

test('explain(install) reports cancelled status as denied', () => {
  const raw = {
    type: 'install',
    id: 'inst_003',
    status: 'cancelled',
    toolIds: ['nmap'],
    plan: [{ id: 'nmap', backend: 'apt', command: 'apt-get' }],
  };
  const out = explain(raw);
  assert.equal(out.status, 'denied');
});

// ─── Registry-type explanation ───────────────────────────────────────────
test('explain(registry/import) reads package + version into target', () => {
  const raw = {
    id: 'reg_001',
    type: 'registry',
    operation: 'import',
    packageId: 'web-recon',
    version: '1.0.0',
    status: 'pending',
    createdAt: '2026-05-20T14:00:00Z',
  };
  const out = explain(raw);
  assert.equal(out.type, 'registry');
  assert.equal(out.target, 'package:web-recon@1.0.0');
  assert.equal(out.actionClass, 'registry.import');
  assert.match(out.policyReason, /import/);
  assert.match(out.expectedEffect, /web-recon@1\.0\.0/);
  assert.ok(out.sideEffects.some(s => /disabled/i.test(s)));
  assert.ok(out.sideEffects.some(s => /NOT execute/i.test(s)));
});

test('explain(registry/install) describes execution side effects', () => {
  const raw = {
    type: 'registry',
    operation: 'install',
    packageId: 'cred-audit',
    version: '0.4.1',
    status: 'pending',
  };
  const out = explain(raw);
  assert.equal(out.actionClass, 'registry.install');
  assert.match(out.expectedEffect, /Installs registry package/);
  assert.ok(out.sideEffects.some(s => /elevated/i.test(s)));
  assert.ok(out.sideEffects.some(s => /network/i.test(s)));
});

// ─── Elevated-type explanation ───────────────────────────────────────────
test('explain(elevated) detects sudo + destructive command', () => {
  const raw = {
    id: 'elev_001',
    type: 'elevated',
    command: 'sudo rm -rf /var/log/old',
    risk: 'destructive',
    status: 'pending',
  };
  const out = explain(raw);
  assert.equal(out.type, 'elevated');
  assert.equal(out.target, 'cmd:sudo');
  assert.equal(out.actionClass, 'elevated.execute_command');
  assert.equal(out.riskClass, 'destructive');
  assert.match(out.policyReason, /sudo|elevated/i);
  assert.match(out.expectedEffect, /sudo rm/);
  assert.ok(out.sideEffects.some(s => /elevated|root/i.test(s)));
  assert.ok(
    out.sideEffects.some(s => /destructive|irreversibly/i.test(s)),
    'elevated rm -rf should warn about destructiveness',
  );
});

test('explain(elevated) truncates very long commands in expected effect', () => {
  const longCmd = 'sudo apt-get install -y ' + 'pkg '.repeat(80);
  const raw = { type: 'elevated', command: longCmd, status: 'pending' };
  const out = explain(raw);
  assert.ok(out.expectedEffect.length < longCmd.length + 30);
  assert.ok(/…$/.test(out.expectedEffect), 'long commands should be ellipsized');
});

test('explain(elevated) notes package-manager invocation', () => {
  const raw = {
    type: 'elevated',
    command: 'sudo apt install nmap',
    status: 'pending',
  };
  const out = explain(raw);
  assert.ok(out.sideEffects.some(s => /package manager/i.test(s)));
});

// ─── Raw-details preservation ────────────────────────────────────────────
test('explain preserves the raw record verbatim under rawDetails', () => {
  const raw = {
    id: 'verbatim_001',
    type: 'scope',
    toolName: 'execute_command',
    args: { command: 'curl https://example.com', deep: { extra: 42, list: [1, 2, 3] } },
    risk: 'recon',
    decision: 'granted',
    metadata: { policyMode: 'governed', anything: 'goes' },
  };
  const out = explain(raw);
  // Identity-preserved (same reference) so the UI can pretty-print the JSON
  // disclosure without hand-rebuilding the original record.
  assert.equal(out.rawDetails, raw);
  // Full deep equality also holds.
  assert.deepEqual(out.rawDetails, raw);
  assert.deepEqual(out.rawDetails.args.deep, { extra: 42, list: [1, 2, 3] });
});

test('explain throws for non-object input', () => {
  assert.throws(() => explain(null), /must be an object/);
  assert.throws(() => explain('not an object'), /must be an object/);
});

// ─── Side-effect derivation ──────────────────────────────────────────────
test('side effects always include a trace-event write for scope events', () => {
  const samples = [
    { type: 'scope', toolName: 'web_request', args: { url: 'https://x.io' }, risk: 'recon' },
    { type: 'scope', toolName: 'execute_command', args: { command: 'whoami' }, risk: 'read/local' },
    { type: 'scope', toolName: 'write_file', args: { path: '/tmp/x' }, risk: 'read/local' },
  ];
  for (const sample of samples) {
    const out = explain(sample);
    assert.ok(
      out.sideEffects.some(s => /trace event/i.test(s)),
      `scope side effects should mention a trace event write (sample: ${sample.toolName})`,
    );
  }
});

test('side effects for online-bruteforce mention account lockout risk', () => {
  const raw = {
    type: 'scope',
    toolName: 'execute_command',
    args: { command: 'hydra -l admin -P passwords.txt ssh://host' },
    risk: 'online-bruteforce',
  };
  const out = explain(raw);
  assert.ok(
    out.sideEffects.some(s => /lock|auth/i.test(s)),
    'online-bruteforce should warn about lockout / auth attempts',
  );
});

test('side effects for install include network egress note', () => {
  const raw = {
    type: 'install',
    toolIds: ['nmap'],
    plan: [{ id: 'nmap', backend: 'apt', command: 'apt-get' }],
    status: 'pending',
  };
  const out = explain(raw);
  assert.ok(out.sideEffects.some(s => /network/i.test(s)));
});

// ─── Denial-reason gating ────────────────────────────────────────────────
test('requiresDenialReason flags high|crit risk classes', () => {
  assert.equal(requiresDenialReason('exploit'), true);
  assert.equal(requiresDenialReason('destructive'), true);
  assert.equal(requiresDenialReason('online-bruteforce'), true);
  assert.equal(requiresDenialReason('offline-password-audit'), true);
  assert.equal(requiresDenialReason('credentialed'), true);
  assert.equal(requiresDenialReason('recon'), false);
  assert.equal(requiresDenialReason('network-scan'), false);
  assert.equal(requiresDenialReason('read/local'), false);
  assert.equal(requiresDenialReason('unknown'), false);
});

test('requiresDenialReason accepts an explained approval object', () => {
  const explained = explain({
    type: 'scope',
    toolName: 'execute_command',
    args: { command: 'msfconsole -r exploit.rc' },
    risk: 'exploit',
  });
  assert.equal(requiresDenialReason(explained), true);
});

test('HIGH_RISK_CLASSES export is frozen and covers the canonical set', () => {
  assert.ok(Object.isFrozen(HIGH_RISK_CLASSES));
  assert.ok(HIGH_RISK_CLASSES.includes('exploit'));
  assert.ok(HIGH_RISK_CLASSES.includes('destructive'));
});

// ─── Denial reason persistence on the explained shape ────────────────────
test('explain echoes denial_reason from snake_case column', () => {
  const raw = {
    type: 'scope',
    toolName: 'execute_command',
    args: { command: 'hashcat -m 0 hashes.txt' },
    risk: 'offline-password-audit',
    decision: 'denied',
    denial_reason: 'wrong scope — sensitive hash file',
  };
  const out = explain(raw);
  assert.equal(out.denialReason, 'wrong scope — sensitive hash file');
  assert.equal(out.status, 'denied');
});
