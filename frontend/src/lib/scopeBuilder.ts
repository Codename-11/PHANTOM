// Scope-builder primitives — the React port of frontend/js/scope/scope-builder.js.
//
// GOVERNANCE-CRITICAL. This module owns the canonical action-class matrix
// and the three-state mode semantics (auto / ask / deny). Mirrors
// server/scope/policy.js + the legacy ScopeBuilder API:
//   - ACTION_CLASSES: the canonical risk-class catalogue. `locked` rows
//     (exploit, destructive) are policy-mandated and are ALWAYS deny — they
//     can never be elevated from the builder.
//   - resolveModeForRow: unspecified classes default to DENY (deny-default).
//   - readActionModes: locked rows are re-pinned to deny on every read so a
//     UI bug can never widen them.
//
// Page-scoped (named for scope) — only ScopeCreate.tsx consumes it.

export type ScopeActionMode = 'auto' | 'ask' | 'deny';

// ── Reference-data shapes (page-scoped; not in lib/types.ts) ───────────

// /api/scopes/roe-templates → { templates: RoeTemplate[] }. The payload is a
// partial scope (action_modes + windows + rate caps + ROE prose).
export interface RoeTemplate {
  id: string;
  name: string;
  summary?: string;
  payload?: {
    action_modes?: Record<string, ScopeActionMode>;
    active_hours?: unknown;
    blackout_windows?: unknown;
    rate_caps?: unknown;
    rules_of_engagement?: string;
  };
}

// /api/assets row projection — only the fields the asset picker needs.
export interface ScopeAssetOption {
  id: string;
  name: string;
  type?: string;
}

export interface ScopeActionClass {
  id: string;
  risk: 'low' | 'med' | 'high' | 'crit';
  examples: string;
  locked?: boolean;
}

// Canonical action-class set (mirrors server/scope/policy.js RISKY_RISKS +
// SAFE_RISKS and the legacy ACTION_CLASSES array, in the same order).
export const ACTION_CLASSES: ScopeActionClass[] = [
  { id: 'read/local', risk: 'low', examples: 'list_directory · read_file · workspace I/O' },
  { id: 'recon', risk: 'low', examples: 'web_request · dns · whois · ct-logs' },
  { id: 'network-scan', risk: 'med', examples: 'nmap · masscan · vulners' },
  { id: 'web-vuln', risk: 'high', examples: 'sqlmap (detect) · nuclei · ffuf' },
  { id: 'credentialed', risk: 'high', examples: 'auth probes with stored creds reference' },
  { id: 'offline-password-audit', risk: 'med', examples: 'hashcat · john · local hashes only' },
  { id: 'online-bruteforce', risk: 'high', examples: 'hydra · medusa · ncrack (authorized)' },
  { id: 'exploit', risk: 'crit', examples: 'msfconsole · payload execution', locked: true },
  { id: 'destructive', risk: 'crit', examples: 'INSERT/UPDATE/DELETE · file write to target', locked: true },
];

export type ScopeActionModes = Record<string, ScopeActionMode>;

// Resolve a row's mode from a saved/draft state. Priority:
//   1. action_modes map — the new canonical field.
//   2. legacy allowed/blocked arrays — backwards compat.
// In BOTH paths an unspecified class resolves to 'deny' (deny-default).
export function resolveModeForRow(
  rowId: string,
  state: {
    action_modes?: ScopeActionModes | null;
    allowed?: string[];
    blocked?: string[];
  } = {},
): ScopeActionMode {
  const modes = state.action_modes;
  if (modes && typeof modes === 'object') {
    const v = modes[rowId];
    if (v === 'auto' || v === 'ask' || v === 'deny') return v;
    return 'deny'; // unspecified → implicit deny
  }
  const blocked = new Set((state.blocked || []).map((s) => String(s).toLowerCase()));
  const allowed = new Set((state.allowed || []).map((s) => String(s).toLowerCase()));
  if (blocked.has(rowId)) return 'deny';
  if (allowed.has(rowId)) return 'auto';
  return 'deny';
}

// Build the initial action_modes map for a fresh builder: every class deny
// except read/local + recon (the canonical safe baseline). Locked rows stay
// deny. This is the React equivalent of the matrix's default render.
export function defaultActionModes(): ScopeActionModes {
  const modes: ScopeActionModes = {};
  for (const cls of ACTION_CLASSES) {
    if (cls.locked) modes[cls.id] = 'deny';
    else if (cls.id === 'read/local' || cls.id === 'recon') modes[cls.id] = 'auto';
    else modes[cls.id] = 'deny';
  }
  return modes;
}

// Re-pin locked rows to deny on every read so a UI bug can never widen them,
// and ensure every canonical class has an explicit entry (deny-default).
export function normalizeActionModes(input: ScopeActionModes | null | undefined): ScopeActionModes {
  const out: ScopeActionModes = {};
  for (const cls of ACTION_CLASSES) {
    if (cls.locked) {
      out[cls.id] = 'deny';
      continue;
    }
    const v = input?.[cls.id];
    out[cls.id] = v === 'auto' || v === 'ask' || v === 'deny' ? v : 'deny';
  }
  return out;
}

// Set one row's mode. Locked rows are a hard no-op pinned to deny.
export function setActionMode(
  modes: ScopeActionModes,
  rowId: string,
  next: ScopeActionMode,
): ScopeActionModes {
  const cls = ACTION_CLASSES.find((c) => c.id === rowId);
  if (cls?.locked) return { ...modes, [rowId]: 'deny' };
  return { ...modes, [rowId]: next };
}

// Derive the legacy allowed/blocked CSV arrays from an action_modes map so
// the create payload keeps both the canonical field and the back-compat
// arrays the policy evaluator still reads. `auto` → allowed, `deny` → blocked,
// `ask` lands in neither (it gates per-call instead of pre-authorizing).
export function deriveAllowedBlocked(modes: ScopeActionModes): {
  allowedActions: string[];
  blockedActions: string[];
} {
  const allowedActions: string[] = [];
  const blockedActions: string[] = [];
  for (const [id, mode] of Object.entries(modes)) {
    if (mode === 'auto') allowedActions.push(id);
    else if (mode === 'deny') blockedActions.push(id);
  }
  return { allowedActions, blockedActions };
}

// ── Template → draft ──────────────────────────────────────────────────
// Mirrors legacy templateToDraft(): an intent template seeds name suffix,
// allowed/blocked classes, notes, and toolpack ids.
export interface ScopeTemplateDraft {
  nameSuffix: string;
  allowedActions: string[];
  blockedActions: string[];
  notes: string;
  toolpackIds: string[];
}

export function templateToDraft(template: {
  name?: string;
  allowedActions?: string[];
  blockedActions?: string[];
  notes?: string;
  summary?: string;
  toolpackIds?: string[];
}): ScopeTemplateDraft {
  return {
    nameSuffix: template.name || 'Custom Scope',
    allowedActions: Array.isArray(template.allowedActions) ? [...template.allowedActions] : [],
    blockedActions: Array.isArray(template.blockedActions) ? [...template.blockedActions] : [],
    notes: template.notes || template.summary || '',
    toolpackIds: Array.isArray(template.toolpackIds) ? [...template.toolpackIds] : [],
  };
}

// Compute an action_modes map from a template's allowed/blocked arrays.
// auto for allowed, deny for blocked + everything unspecified, locked rows
// always deny. (Templates never carry a 3-state map, only CSV arrays.)
export function templateActionModes(template: {
  allowedActions?: string[];
  blockedActions?: string[];
}): ScopeActionModes {
  const allowed = new Set((template.allowedActions || []).map((s) => String(s).toLowerCase()));
  const modes: ScopeActionModes = {};
  for (const cls of ACTION_CLASSES) {
    if (cls.locked) modes[cls.id] = 'deny';
    else modes[cls.id] = allowed.has(cls.id) ? 'auto' : 'deny';
  }
  return modes;
}

// A coarse risk badge for an intent tile — mirrors legacy templateRisk().
export function templateRisk(template: {
  allowedActions?: string[];
  blockedActions?: string[];
}): 'info' | 'low' | 'med' | 'high' {
  const allowed = template.allowedActions || [];
  const blocked = (template.blockedActions || []).join(',');
  if (/destructive|exploit/.test(blocked) && allowed.some((a) => /credential|brute/.test(a))) return 'high';
  if (allowed.some((a) => /network-scan|web-vuln|credentialed|exploit/.test(a))) return 'med';
  if (!allowed.length) return 'info';
  return 'low';
}
