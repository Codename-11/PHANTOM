// server/approvals/explain.js
//
// Pure formatter that turns a raw approval record into the structured
// "explainable" shape the Approvals UI renders. This module is intentionally
// dependency-free — no DB, no fs, no network — so callers can pass any raw
// approval-shaped record (trace event row, install_request row, future
// registry import row, future elevated-command record) and get back a
// human-readable description suitable for the operator card.
//
// Output shape:
//   {
//     id,                         // stable identifier
//     type: 'scope'|'install'|'registry'|'elevated',
//     target,                     // host.com / asset:abc / package:web-recon@1.0.0
//     riskClass,                  // recon / network-scan / install.apt / ...
//     actionClass,                // tool.web_request / install.apt / sudo.execute_command / ...
//     policyReason,               // human sentence — why this needs approval
//     expectedEffect,             // 1-line description of what approving causes
//     sideEffects: string[],      // plain-language strings
//     rawDetails: { ... },        // original raw record verbatim
//     createdAt,                  // ISO timestamp
//     status: 'pending'|'approved'|'denied',
//     denialReason: null|string,  // operator note when high|crit denial
//   }

const HIGH_OR_CRIT_RISKS = new Set([
  'exploit',
  'destructive',
  'online-bruteforce',
  'offline-password-audit',
  'credentialed',
]);

const RISK_HUMAN_LABEL = {
  recon: 'passive reconnaissance',
  'network-scan': 'active network probing',
  exploit: 'exploitation attempt',
  destructive: 'destructive action',
  credentialed: 'credentialed/privileged action',
  'offline-password-audit': 'offline password cracking',
  'online-bruteforce': 'online credential brute-force',
  unknown: 'an unclassified action',
};

const TOOL_ACTION_CLASS = {
  web_request: 'tool.web_request',
  search_web: 'tool.search_web',
  scrape_webpage: 'tool.scrape_webpage',
  scrapling_fetch: 'tool.scrapling_fetch',
  execute_command: 'tool.execute_command',
  python_execute: 'tool.python_execute',
  install_tool: 'tool.install_tool',
  read_file: 'tool.read_file',
  write_file: 'tool.write_file',
  list_directory: 'tool.list_directory',
  edit_source_code: 'tool.edit_source_code',
  save_memory: 'tool.save_memory',
  recall_memory: 'tool.recall_memory',
  save_trace: 'tool.save_trace',
  show_preview_window: 'tool.show_preview_window',
};

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function pluralize(n, singular, plural) {
  return n === 1 ? `1 ${singular}` : `${n} ${plural || singular + 's'}`;
}

function decisionToStatus(decision) {
  if (!decision) return 'pending';
  const d = String(decision).toLowerCase();
  if (d === 'granted' || d === 'allow-once' || d === 'override' || d === 'approved') return 'approved';
  if (d === 'denied' || d === 'timeout' || d === 'cancelled') return 'denied';
  return 'pending';
}

function rawRequestStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return 'pending';
  if (s === 'cancelled' || s === 'failed') return 'denied';
  if (s === 'running' || s === 'completed' || s === 'approved') return 'approved';
  return 'pending';
}

// ─── Type detection ──────────────────────────────────────────────────────
//
// Callers may either set `type` explicitly on the raw record or rely on
// structural detection. The detector prefers explicit `type` then falls
// back to a structural sniff.
export function detectApprovalType(record) {
  if (!record || typeof record !== 'object') return 'scope';
  if (record.type === 'scope' || record.type === 'install'
      || record.type === 'registry' || record.type === 'elevated') {
    return record.type;
  }
  if (record.kind === 'registry' || record.source === 'registry' || record.packageId || record.manifestId) {
    return 'registry';
  }
  if (record.kind === 'elevated' || record.elevated === true || record.requiresElevation === true) {
    return 'elevated';
  }
  // install_requests rows: have a `plan` array of {backend, command, args}
  if (Array.isArray(record.plan) && record.plan.some(p => p && (p.backend !== undefined || p.command !== undefined))) {
    return 'install';
  }
  // trace-derived scope events: have toolName + decision/kind 'ask'|'allow-once'
  if (record.toolName || record.tool_name) return 'scope';
  return 'scope';
}

// ─── Target extraction ───────────────────────────────────────────────────
function firstTargetFromArgs(args) {
  if (!args) return null;
  if (typeof args === 'string') {
    const m = args.match(/https?:\/\/[^\s'"<>),]+/i);
    if (m) {
      try { return new URL(m[0]).hostname; } catch { return m[0]; }
    }
    return null;
  }
  if (typeof args === 'object') {
    if (typeof args.url === 'string') {
      try { return new URL(args.url).hostname; } catch { return args.url; }
    }
    if (typeof args.host === 'string') return args.host;
    if (typeof args.target === 'string') return args.target;
    if (typeof args.path === 'string') return args.path;
    if (typeof args.query === 'string') return args.query;
    if (typeof args.command === 'string') {
      const m = args.command.match(/https?:\/\/[^\s'"<>),]+/i);
      if (m) {
        try { return new URL(m[0]).hostname; } catch { return m[0]; }
      }
      // Fall back to second token in the command (often the target).
      const parts = args.command.trim().split(/\s+/);
      if (parts.length >= 2 && !parts[1].startsWith('-')) return parts[1];
      return parts[0];
    }
  }
  return null;
}

function targetFromScopeRecord(record) {
  // Decision/policy events normally carry a precomputed targets[] in metadata.
  const decisionTargets = record?.decision?.targets || record?.targets;
  if (Array.isArray(decisionTargets) && decisionTargets.length) return decisionTargets[0];
  const fromArgs = firstTargetFromArgs(record?.args || record?.input);
  if (fromArgs) return fromArgs;
  return record?.toolName || record?.tool_name || 'unspecified';
}

function targetFromInstallRecord(record) {
  const ids = Array.isArray(record?.toolIds) ? record.toolIds
    : Array.isArray(record?.tool_ids) ? record.tool_ids
    : [];
  if (ids.length === 1) return `package:${ids[0]}`;
  if (ids.length > 1) return `packages:${ids.slice(0, 3).join(',')}${ids.length > 3 ? `+${ids.length - 3}` : ''}`;
  return 'package:unknown';
}

function targetFromRegistryRecord(record) {
  if (record?.packageRef) return record.packageRef;
  const id = record?.packageId || record?.manifestId || record?.id;
  const version = record?.version || record?.packageVersion;
  if (id && version) return `package:${id}@${version}`;
  if (id) return `package:${id}`;
  return 'package:unknown';
}

function targetFromElevatedRecord(record) {
  const cmd = record?.command || record?.args?.command || record?.input?.command;
  if (typeof cmd === 'string' && cmd.trim()) {
    const first = cmd.trim().split(/\s+/)[0];
    return `cmd:${first}`;
  }
  return record?.toolName || record?.tool_name || 'cmd:unknown';
}

// ─── Action class derivation ─────────────────────────────────────────────
function actionClassForScope(record) {
  const tool = record?.toolName || record?.tool_name;
  if (tool && TOOL_ACTION_CLASS[tool]) return TOOL_ACTION_CLASS[tool];
  if (tool) return `tool.${tool}`;
  return 'tool.unknown';
}

function actionClassForInstall(record) {
  const plan = Array.isArray(record?.plan) ? record.plan : [];
  const backends = [...new Set(plan.filter(p => p?.backend).map(p => p.backend))];
  if (backends.length === 1) return `install.${backends[0]}`;
  if (backends.length > 1) return `install.${backends.join('+')}`;
  return 'install.unknown';
}

function actionClassForRegistry(record) {
  const op = record?.operation || record?.op || 'import';
  return `registry.${op}`;
}

function actionClassForElevated(record) {
  const tool = record?.toolName || record?.tool_name || 'execute_command';
  return `elevated.${tool}`;
}

// ─── Risk class derivation ───────────────────────────────────────────────
function riskForScope(record) {
  const direct = record?.risk || record?.decision?.risk;
  if (direct) return String(direct);
  return 'unknown';
}

function riskForInstall(record) {
  // Installs are credentialed by nature (they invoke a privileged package
  // manager) — surface that so the operator sees the risk tier.
  const plan = Array.isArray(record?.plan) ? record.plan : [];
  const hasNetwork = plan.some(p => p?.backend && p.backend !== 'pip-user');
  return hasNetwork ? 'credentialed' : 'credentialed';
}

function riskForRegistry(record) {
  return record?.risk || 'credentialed';
}

function riskForElevated(record) {
  return record?.risk || 'credentialed';
}

// ─── Policy reason ───────────────────────────────────────────────────────
function policyReasonForScope(record) {
  const reason = record?.reason
    || record?.decision?.reason
    || record?.policyReason
    || record?.metadata?.decision?.reason;
  if (reason) return safeString(reason);
  const risk = riskForScope(record);
  const human = RISK_HUMAN_LABEL[risk] || risk;
  const kind = record?.kind || record?.metadata?.kind;
  if (kind === 'ask') return `${risk} actions require operator approval per scope policy (${human}).`;
  if (kind === 'allow-once') return `${risk} is not currently allowed by the active scope — one-time override required (${human}).`;
  return `${risk} action requires approval (${human}).`;
}

function policyReasonForInstall(record) {
  const plan = Array.isArray(record?.plan) ? record.plan : [];
  const ids = Array.isArray(record?.toolIds) ? record.toolIds : (record?.tool_ids || []);
  const backends = [...new Set(plan.filter(p => p?.backend).map(p => p.backend))];
  const verb = backends.length === 1 ? backends[0] : 'a system package manager';
  return `Installing ${pluralize(ids.length, 'security tool')} via ${verb} requires elevated privileges and explicit operator approval.`;
}

function policyReasonForRegistry(record) {
  const op = record?.operation || record?.op || 'import';
  const ref = targetFromRegistryRecord(record);
  return `Registry ${op} of ${ref} requires operator review before any local install/enable.`;
}

function policyReasonForElevated(record) {
  const cmd = record?.command || record?.args?.command || record?.input?.command || '';
  if (/^sudo\b|\bsudo\s/i.test(cmd)) {
    return `Elevated command requested — sudo invocation must be acknowledged by the operator.`;
  }
  return `Privileged command requires operator approval before execution.`;
}

// ─── Expected effect ─────────────────────────────────────────────────────
function expectedEffectForScope(record) {
  const tool = record?.toolName || record?.tool_name || 'tool';
  const target = targetFromScopeRecord(record);
  const argHint = (() => {
    const args = record?.args || record?.input || {};
    if (typeof args === 'object' && args !== null) {
      if (args.url) return ` to ${args.url}`;
      if (args.host) return ` against ${args.host}`;
      if (args.target) return ` against ${args.target}`;
      if (args.query) return ` for "${String(args.query).slice(0, 60)}"`;
      if (args.command) return `: ${String(args.command).slice(0, 80)}`;
    }
    return target && target !== 'unspecified' ? ` against ${target}` : '';
  })();
  return `Runs ${tool}${argHint}.`;
}

function expectedEffectForInstall(record) {
  const plan = Array.isArray(record?.plan) ? record.plan : [];
  const installable = plan.filter(p => p?.backend).length;
  const ids = Array.isArray(record?.toolIds) ? record.toolIds : (record?.tool_ids || []);
  const backends = [...new Set(plan.filter(p => p?.backend).map(p => p.backend))];
  const total = ids.length || plan.length;
  const skipped = total - installable;
  const backendLabel = backends.length ? ` via ${backends.join(' / ')}` : '';
  const skipNote = skipped > 0 ? ` (${skipped} skipped — no available package)` : '';
  return `Installs ${pluralize(installable, 'security tool')}${backendLabel}${skipNote}.`;
}

function expectedEffectForRegistry(record) {
  const op = record?.operation || record?.op || 'import';
  const ref = targetFromRegistryRecord(record);
  if (op === 'install') return `Installs registry package ${ref} into the local toolpack catalog.`;
  if (op === 'enable') return `Enables registry package ${ref} so its tools become available to the agent.`;
  if (op === 'remove') return `Removes registry package ${ref} from the local catalog.`;
  return `Imports manifest for ${ref}; package lands disabled until explicitly enabled.`;
}

function expectedEffectForElevated(record) {
  const cmd = record?.command || record?.args?.command || record?.input?.command || '';
  const shortened = cmd.length > 120 ? `${cmd.slice(0, 117)}…` : cmd;
  return shortened ? `Runs elevated command: ${shortened}` : 'Runs a privileged command on the host.';
}

// ─── Side effects ────────────────────────────────────────────────────────
function sideEffectsForScope(record) {
  const tool = record?.toolName || record?.tool_name || '';
  const risk = riskForScope(record);
  const target = targetFromScopeRecord(record);
  const out = ['Writes 1 trace event to the run timeline.'];
  if (['web_request', 'search_web', 'scrape_webpage', 'scrapling_fetch'].includes(tool)) {
    if (target && target !== 'unspecified') out.push(`May leave a server log entry on ${target}.`);
    out.push('Outbound HTTP request leaves the host.');
  }
  if (tool === 'execute_command' || tool === 'python_execute') {
    out.push('Spawns a child process on the host.');
    if (risk === 'destructive') out.push('May modify or delete local files / system state.');
    if (risk === 'network-scan') out.push('Generates outbound probe traffic — may trip IDS/IPS rules.');
    if (risk === 'exploit') out.push('May trigger defensive controls on the target.');
    if (risk === 'online-bruteforce') out.push('Generates repeated auth attempts — may lock out accounts.');
  }
  if (tool === 'write_file' || tool === 'edit_source_code') {
    out.push('Writes to the local filesystem.');
  }
  if (tool === 'install_tool') {
    out.push('Invokes a system package manager.');
    out.push('Requires elevated privileges.');
  }
  return out;
}

function sideEffectsForInstall(record) {
  const plan = Array.isArray(record?.plan) ? record.plan : [];
  const backends = [...new Set(plan.filter(p => p?.backend).map(p => p.backend))];
  const installable = plan.filter(p => p?.backend).length;
  const out = [];
  if (backends.length) out.push(`Invokes ${backends.join(' / ')} as the package manager.`);
  if (installable > 0) out.push(`Runs ${pluralize(installable, 'install command')} sequentially.`);
  out.push('Requires elevated privileges (sudo / admin).');
  out.push('Downloads packages over the network from upstream repositories.');
  out.push('Modifies the host system: installs new binaries onto PATH.');
  return out;
}

function sideEffectsForRegistry(record) {
  const op = record?.operation || record?.op || 'import';
  const out = [];
  if (op === 'import') {
    out.push('Stores the manifest in the local registry cache (disabled).');
    out.push('Does NOT execute any install steps.');
    out.push('No network egress unless the source is remote and signed.');
  } else if (op === 'install') {
    out.push('Invokes the manifest-declared install recipe.');
    out.push('Requires elevated privileges.');
    out.push('Downloads packages over the network.');
  } else if (op === 'enable') {
    out.push('Exposes the package\'s tools to the agent runtime.');
    out.push('No new processes spawned.');
  } else if (op === 'remove') {
    out.push('Removes the package from the local catalog.');
    out.push('Does not uninstall already-installed binaries.');
  }
  return out;
}

function sideEffectsForElevated(record) {
  const cmd = record?.command || record?.args?.command || record?.input?.command || '';
  const out = ['Runs with elevated privileges (sudo / root).'];
  if (/\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=|\bshutdown\b|\breboot\b/.test(cmd)) {
    out.push('Command is destructive — may modify or delete system state irreversibly.');
  }
  if (/\bcurl\b|\bwget\b/.test(cmd)) {
    out.push('Performs outbound HTTP request from the host.');
  }
  if (/\bapt\b|\byum\b|\bdnf\b|\bpacman\b|\bbrew\b|\bwinget\b/.test(cmd)) {
    out.push('Invokes a system package manager.');
  }
  if (/\bssh\b|\bscp\b/.test(cmd)) {
    out.push('Initiates an outbound SSH session.');
  }
  out.push('Writes 1 trace event recording the elevated invocation.');
  return out;
}

// ─── Main entry ──────────────────────────────────────────────────────────
/**
 * Format a raw approval record into the operator-readable shape.
 *
 * @param {object} record  raw approval record (trace event row, install
 *                         request, registry import, elevated command).
 *                         The original is preserved verbatim under
 *                         result.rawDetails for the <details> disclosure.
 * @returns {object}       structured approval (see module header)
 */
export function explain(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('explain(record): record must be an object');
  }
  const type = detectApprovalType(record);

  const id = safeString(record.id || record.requestId || record.eventId || '');
  const createdAt = record.createdAt || record.created_at
    || record.requested_at || record.occurredAt || record.started_at
    || null;

  let target;
  let actionClass;
  let riskClass;
  let policyReason;
  let expectedEffect;
  let sideEffects;
  let status;

  switch (type) {
    case 'install':
      target = targetFromInstallRecord(record);
      actionClass = actionClassForInstall(record);
      riskClass = riskForInstall(record);
      policyReason = policyReasonForInstall(record);
      expectedEffect = expectedEffectForInstall(record);
      sideEffects = sideEffectsForInstall(record);
      status = rawRequestStatus(record.status);
      break;
    case 'registry':
      target = targetFromRegistryRecord(record);
      actionClass = actionClassForRegistry(record);
      riskClass = riskForRegistry(record);
      policyReason = policyReasonForRegistry(record);
      expectedEffect = expectedEffectForRegistry(record);
      sideEffects = sideEffectsForRegistry(record);
      status = rawRequestStatus(record.status);
      break;
    case 'elevated':
      target = targetFromElevatedRecord(record);
      actionClass = actionClassForElevated(record);
      riskClass = riskForElevated(record);
      policyReason = policyReasonForElevated(record);
      expectedEffect = expectedEffectForElevated(record);
      sideEffects = sideEffectsForElevated(record);
      status = record.decision
        ? decisionToStatus(record.decision)
        : rawRequestStatus(record.status);
      break;
    case 'scope':
    default:
      target = targetFromScopeRecord(record);
      actionClass = actionClassForScope(record);
      riskClass = riskForScope(record);
      policyReason = policyReasonForScope(record);
      expectedEffect = expectedEffectForScope(record);
      sideEffects = sideEffectsForScope(record);
      status = decisionToStatus(record.decision);
      break;
  }

  const denialReason = (record.denialReason !== undefined ? record.denialReason
    : record.denial_reason !== undefined ? record.denial_reason
    : null) || null;

  return {
    id,
    type,
    target,
    riskClass,
    actionClass,
    policyReason,
    expectedEffect,
    sideEffects,
    rawDetails: record,
    createdAt: createdAt || null,
    status,
    denialReason,
  };
}

/**
 * Returns true if a denial of this approval requires an explicit operator
 * note. Used by the UI to enforce the "high/crit denials need a reason"
 * rule before submitting the decision.
 */
export function requiresDenialReason(approvalOrRiskClass) {
  const risk = typeof approvalOrRiskClass === 'string'
    ? approvalOrRiskClass
    : approvalOrRiskClass?.riskClass;
  return HIGH_OR_CRIT_RISKS.has(String(risk || '').toLowerCase());
}

export const HIGH_RISK_CLASSES = Object.freeze([...HIGH_OR_CRIT_RISKS]);
