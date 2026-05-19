const SAFE_RISKS = new Set(['read/local']);
const RISKY_RISKS = new Set(['recon', 'network-scan', 'exploit', 'destructive', 'credentialed', 'offline-password-audit', 'online-bruteforce', 'unknown']);
const BLOCKED_CREDENTIAL_SUBRISKS = new Set(['offline-password-audit', 'online-bruteforce']);
const DEFAULT_OPERATOR_OVERRIDE_REASON = 'Operator-enabled test run';
const SECRET_VALUE_RE = /\b(api[_-]?key|token|password|passwd|secret|authorization|bearer)\b\s*[:=]?\s*([^\s,;]+)/gi;

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const URL_RE = /https?:\/\/[^\s'"<>),]+/gi;
const HOST_PORT_RE = /\b((?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::(\d{1,5}))\b/gi;
const DOMAIN_RE = /\b(?!(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.\d{1,3}){3}\b)(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
const LOCAL_FILE_VALUE_FLAGS = new Set([
  '-p', '-P', '-l', '-L', '-C', // hydra password/login/colon-separated credential files
  '-w', '--wordlist', '--usernames', '--passwords',
  '-iL', '-oN', '-oX', '-oG', '-oA',
  '-r', '--request-file', '--config', '--output', '-o',
]);
const OFFLINE_PASSWORD_TOOLS = new Set(['john', 'hashcat', 'hashid', 'nth', 'name-that-hash', 'unshadow', 'hash-identifier']);

// Canonical action class universe. Used by the scope builder to render the
// three-state matrix and by the policy evaluator to resolve modes. Order
// matches the existing risk-classification output of classifyRisk().
export const ACTION_CLASSES = [
  'read/local',
  'recon',
  'network-scan',
  'exploit',
  'destructive',
  'credentialed',
  'offline-password-audit',
  'online-bruteforce',
];

function stringifyInput(args) {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try { return JSON.stringify(args); } catch { return String(args); }
}

function shellishTokens(text) {
  return String(text).match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g)?.map(token => token.replace(/^['"]|['"]$/g, '')) || [];
}

function tokenCommandName(token) {
  const cleaned = String(token || '').split(/[\\/]/).pop().toLowerCase();
  return cleaned.replace(/(?:\.exe|\.py|\.sh)$/i, '');
}

function isOfflinePasswordCommand(tokens) {
  return tokens.some(token => OFFLINE_PASSWORD_TOOLS.has(tokenCommandName(token)));
}

function addFileCandidate(out, value) {
  const cleaned = String(value || '').replace(/^['"]|['"]$/g, '').replace(/[),;]+$/g, '');
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return;
  const basename = cleaned.split(/[\\/]/).pop();
  for (const candidate of [cleaned, basename]) {
    if (candidate && candidate.includes('.')) out.add(candidate.toLowerCase());
  }
}

function localFileCandidates(args = {}) {
  const texts = [];
  if (typeof args === 'string') texts.push(args);
  if (args && typeof args === 'object') {
    for (const value of Object.values(args)) {
      if (typeof value === 'string') texts.push(value);
    }
  }
  const out = new Set();
  for (const text of texts) {
    const tokens = shellishTokens(text);
    const offlinePasswordCommand = isOfflinePasswordCommand(tokens);
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const [maybeFlag, maybeValue] = token.split('=', 2);
      if (LOCAL_FILE_VALUE_FLAGS.has(maybeFlag) && maybeValue) addFileCandidate(out, maybeValue);
      if (LOCAL_FILE_VALUE_FLAGS.has(token) && tokens[i + 1]) addFileCandidate(out, tokens[i + 1]);
      for (const flag of LOCAL_FILE_VALUE_FLAGS) {
        if (flag.length > 2 && token.startsWith(flag) && token.length > flag.length) {
          addFileCandidate(out, token.slice(flag.length));
        }
      }
      if (offlinePasswordCommand && !token.startsWith('-') && !/^https?:\/\//i.test(token)) {
        addFileCandidate(out, token);
      }
    }
  }
  return out;
}

export function extractTargets(args = {}) {
  const text = stringifyInput(args);
  const localFiles = localFileCandidates(args);
  const out = new Set();
  for (const url of text.match(URL_RE) || []) {
    out.add(url);
    try {
      const parsed = new URL(url);
      out.add(parsed.hostname);
      if (parsed.port) out.add(`${parsed.hostname}:${parsed.port}`);
    } catch {}
  }
  for (const match of text.matchAll(HOST_PORT_RE)) {
    out.add(match[1]);
    out.add(`${match[1]}:${match[2]}`);
  }
  const splitPortRe = /\b(?:nc|netcat|ncat)\s+(?:-[a-zA-Z]+\s+)*((?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)|(?:[a-z0-9-]+\.)+[a-z]{2,})\s+(\d{1,5})\b/gi;
  for (const match of text.matchAll(splitPortRe)) {
    out.add(match[1]);
    out.add(`${match[1]}:${match[2]}`);
  }
  for (const ip of text.match(IPV4_RE) || []) out.add(ip);
  for (const domain of text.match(DOMAIN_RE) || []) {
    const normalized = domain.toLowerCase();
    if (!domain.includes('..') && !localFiles.has(normalized)) out.add(normalized);
  }
  return Array.from(out);
}

export function classifyRisk(toolName, args = {}) {
  const text = stringifyInput(args).toLowerCase();
  if (['read_file', 'list_directory', 'recall_memory'].includes(toolName)) return 'read/local';
  if (['write_file', 'save_memory', 'show_preview_window'].includes(toolName)) return 'read/local';
  if (toolName === 'web_request' || toolName === 'scrape_webpage' || toolName === 'search_web' || toolName === 'scrapling_fetch') return 'recon';
  if (toolName === 'install_tool') return 'credentialed';
  if (toolName === 'execute_command' || toolName === 'python_execute') {
    if (/\b(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|killall|chmod\s+-r|chown\s+-r)\b/.test(text)) return 'destructive';
    if (/\b(hydra|medusa|ncrack|crowbar|patator)\b/.test(text)) return 'online-bruteforce';
    if (/\b(john|hashcat|hashid|name-that-hash|\bnth\b|unshadow|hash-identifier)\b/.test(text)) return 'offline-password-audit';
    if (/\b(sudo|su\s|ssh\s|scp\s|rsync\s|password|passwd|token|credential)\b/.test(text)) return 'credentialed';
    if (/\b(sqlmap|msfconsole|metasploit|exploit|payload|reverse\s+shell|nc\s+-e|ncat\s+-e)\b/.test(text)) return 'exploit';
    if (/\b(nmap|masscan|gobuster|ffuf|nuclei|nikto|subfinder|httpx|amass|dirb|dirsearch|nc\s+-vz|netcat\s+-vz)\b/.test(text)) return 'network-scan';
    if (extractTargets(args).length > 0 && /\b(curl|wget|dig|host|ping|traceroute|openssl\s+s_client|nc|netcat)\b/.test(text)) return 'recon';
    return 'read/local';
  }
  return 'unknown';
}

function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return null;
  return parts.reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
}

function cidrContains(cidr, ip) {
  const [base, bitsRaw] = String(cidr).split('/');
  const bits = Number(bitsRaw);
  const baseInt = ipToInt(base);
  const ipInt = ipToInt(ip);
  if (baseInt == null || ipInt == null || Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

function hostnameFromTarget(target) {
  try { return new URL(target).hostname.toLowerCase(); } catch {}
  return String(target).split(':')[0].toLowerCase();
}

function targetInScope(target, scope) {
  const targets = scope?.targets || {};
  const hosts = (targets.hosts || []).map(item => String(item).toLowerCase());
  const domains = (targets.domains || []).map(item => String(item).toLowerCase().replace(/^\*\./, ''));
  const urls = targets.urls || [];
  const cidrs = targets.cidrs || [];
  const raw = String(target).toLowerCase();
  const host = hostnameFromTarget(raw);
  if (hosts.includes(raw) || hosts.includes(host)) return true;
  if (urls.some(url => raw.startsWith(String(url).toLowerCase()) || String(url).toLowerCase().startsWith(raw))) return true;
  if (domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return true;
  if (ipToInt(host) != null && cidrs.some(cidr => cidrContains(cidr, host))) return true;
  return false;
}

function normalizeActions(actions = []) {
  return new Set((actions || []).map(action => String(action).toLowerCase()));
}

function blockedActionMatches(actions, risk) {
  if (actions.has(risk)) return true;
  return BLOCKED_CREDENTIAL_SUBRISKS.has(risk) && actions.has('credentialed');
}

function allowedActionMatches(actions, risk) {
  return actions.has(risk);
}

function redactText(text) {
  return String(text || '').replace(SECRET_VALUE_RE, (_match, key) => `${key}=[REDACTED]`);
}

export function normalizeOperatorOverride(operatorOverride = null) {
  const enabled = operatorOverride === true || operatorOverride?.enabled === true;
  if (!enabled) return { enabled: false };
  const reason = redactText(operatorOverride?.reason || DEFAULT_OPERATOR_OVERRIDE_REASON).slice(0, 240);
  return { enabled: true, reason: reason || DEFAULT_OPERATOR_OVERRIDE_REASON };
}

function operatorOverrideDecision({ risk, targets, operatorOverride }) {
  const normalized = normalizeOperatorOverride(operatorOverride);
  if (!normalized.enabled) return null;
  return {
    allowed: true,
    mode: 'auto',
    reason: `Operator Override active: governed scope checks bypassed for this test run`,
    risk,
    targets,
    policyMode: 'operator-override',
    operatorOverride: normalized,
  };
}

// ─── New: action_modes resolution ──────────────────────────────────────────
//
// Scopes can now declare a per-action-class mode: 'auto' | 'ask' | 'deny'.
// `auto` runs immediately. `ask` pauses for operator approval in chat.
// `deny` blocks outright.
//
// Backwards compat: if `action_modes` isn't set, fall back to the legacy
// allowed_actions/blocked_actions arrays. Anything in `blocked_actions` is
// treated as `deny` (explicit). Anything in `allowed_actions` is `auto`.
// Anything outside both is `deny` (implicit — eligible for one-time override).
function resolveActionMode(scope, risk) {
  const modes = scope?.action_modes || scope?.actionModes;
  if (modes && typeof modes === 'object') {
    const direct = modes[risk];
    if (direct === 'auto' || direct === 'ask' || direct === 'deny') {
      return { mode: direct, explicit: true };
    }
    // Treat credentialed→offline-password-audit/online-bruteforce parent role
    // when no specific entry exists.
    if (BLOCKED_CREDENTIAL_SUBRISKS.has(risk) && modes.credentialed === 'deny') {
      return { mode: 'deny', explicit: true };
    }
    // Defined map but no entry for this risk → implicit deny (allow-once
    // override possible in chat).
    return { mode: 'deny', explicit: false };
  }
  // Legacy fallback
  const blocked = normalizeActions(scope?.blocked_actions || scope?.blockedActions);
  if (blockedActionMatches(blocked, risk)) return { mode: 'deny', explicit: true };
  const allowed = normalizeActions(scope?.allowed_actions || scope?.allowedActions);
  if (allowed.size === 0) return { mode: 'auto', explicit: false };
  if (allowedActionMatches(allowed, risk)) return { mode: 'auto', explicit: true };
  return { mode: 'deny', explicit: false };
}

// ─── Time windows: active_hours + blackout_windows ────────────────────────
//
// Shape: { timezone: 'UTC' (optional, defaults UTC), windows: [{days, start, end}] }
// days: ['mon','tue',...] (lowercase 3-letter), start/end as 'HH:MM' 24h.
// A scope with `active_hours` requires that the current time falls within at
// least one window. A scope with `blackout_windows` blocks if current time
// matches any window. Both are evaluated in UTC unless `timezone` is set
// (we only support UTC and the host TZ for now — true tz conversion is a
// follow-up).
function parseTimeStr(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

function withinWindow(now, window) {
  const days = (window?.days || []).map((d) => String(d).slice(0, 3).toLowerCase());
  const startMin = parseTimeStr(window?.start);
  const endMin = parseTimeStr(window?.end);
  if (startMin == null || endMin == null) return false;
  const dayKey = DAY_KEYS[now.getUTCDay()];
  if (days.length && !days.includes(dayKey)) return false;
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  // Wrap-around windows (e.g. 22:00–02:00) are honored when end < start.
  if (endMin >= startMin) return nowMin >= startMin && nowMin <= endMin;
  return nowMin >= startMin || nowMin <= endMin;
}

function timeWindowDecision(scope, now) {
  const active = scope?.active_hours?.windows;
  if (Array.isArray(active) && active.length) {
    const inWindow = active.some((w) => withinWindow(now, w));
    if (!inWindow) {
      return { ok: false, reason: 'outside scope active-hours window' };
    }
  }
  const blackout = scope?.blackout_windows?.windows;
  if (Array.isArray(blackout) && blackout.length) {
    const inBlackout = blackout.some((w) => withinWindow(now, w));
    if (inBlackout) {
      return { ok: false, reason: 'inside scope blackout window' };
    }
  }
  return { ok: true };
}

// ─── Rate caps ─────────────────────────────────────────────────────────────
//
// Shape on scope: { requests_per_minute, max_actions_per_run }.
// `usage` is passed by the caller (scope/rate-limiter.js maintains it):
//   { lastMinute: number, thisRun: number }
// Override mode bypasses these — operator already accepted responsibility.
function rateCapDecision(scope, usage) {
  const caps = scope?.rate_caps || scope?.rateCaps;
  if (!caps || typeof caps !== 'object') return { ok: true };
  if (typeof caps.requests_per_minute === 'number' && usage?.lastMinute >= caps.requests_per_minute) {
    return { ok: false, reason: `rate cap: ${caps.requests_per_minute} requests/minute exceeded` };
  }
  if (typeof caps.max_actions_per_run === 'number' && usage?.thisRun >= caps.max_actions_per_run) {
    return { ok: false, reason: `rate cap: ${caps.max_actions_per_run} actions/run exceeded` };
  }
  return { ok: true };
}

// ─── Main evaluator ────────────────────────────────────────────────────────
//
// Decision shape:
//   {
//     allowed: bool,            // can the action proceed without further intervention?
//     mode: 'auto' | 'ask' | 'deny',
//     explicit: bool,           // true if the scope explicitly named this action
//     reason: string,
//     risk: string,
//     targets: string[],
//     policyMode: 'governed' | 'operator-override',
//     gate: 'action' | 'time' | 'rate' | 'target' | 'expiry' | null
//   }
//
// For the executor:
//   - mode 'auto' AND allowed → run normally
//   - mode 'ask'              → pause for operator approval (kind: 'ask')
//   - mode 'deny' AND explicit → block, no override card
//   - mode 'deny' AND !explicit → pause for one-time override (kind: 'allow-once')
//   - operator override active → always mode 'auto', policyMode 'operator-override'
export function evaluateToolAction({ toolName, args = {}, scope = null, now = new Date(), operatorOverride = null, usage = null }) {
  const risk = classifyRisk(toolName, args);
  const targets = extractTargets(args);

  if (SAFE_RISKS.has(risk)) {
    return { allowed: true, mode: 'auto', explicit: true, reason: 'Safe local/read action', risk, targets, policyMode: 'governed', gate: null };
  }
  if (!RISKY_RISKS.has(risk)) {
    return { allowed: false, mode: 'deny', explicit: true, reason: `Unknown risk class: ${risk}`, risk, targets, policyMode: 'governed', gate: 'action' };
  }

  // Operator override is total bypass — every gate skipped.
  const overrideDecision = operatorOverrideDecision({ risk, targets, operatorOverride });
  if (overrideDecision) return { ...overrideDecision, explicit: true, gate: null };

  // No scope at all = implicit deny (eligible for allow-once override card).
  if (!scope) {
    return { allowed: false, mode: 'deny', explicit: false, reason: `No selected scope for ${risk} action`, risk, targets, policyMode: 'governed', gate: 'action' };
  }

  // Archive and expiry are "explicit" — operator made these terminal decisions.
  if (scope.archived_at) {
    return { allowed: false, mode: 'deny', explicit: true, reason: `Scope "${scope.name}" is archived`, risk, targets, policyMode: 'governed', gate: 'expiry' };
  }
  if (scope.expires_at && new Date(scope.expires_at).getTime() < now.getTime()) {
    // Expiry is implicit-deny: operator can override for one more action.
    return { allowed: false, mode: 'deny', explicit: false, reason: `Scope "${scope.name}" is expired`, risk, targets, policyMode: 'governed', gate: 'expiry' };
  }

  // Action-class gate (auto / ask / deny).
  const actionResolution = resolveActionMode(scope, risk);
  if (actionResolution.mode === 'deny') {
    return {
      allowed: false,
      mode: 'deny',
      explicit: actionResolution.explicit,
      reason: actionResolution.explicit
        ? `${risk} is explicitly denied by scope policy`
        : `${risk} is not allowed by selected scope`,
      risk, targets, policyMode: 'governed', gate: 'action',
    };
  }

  // Time-window gate.
  const tw = timeWindowDecision(scope, now);
  if (!tw.ok) {
    return { allowed: false, mode: 'deny', explicit: false, reason: tw.reason, risk, targets, policyMode: 'governed', gate: 'time' };
  }

  // Rate caps.
  const rc = rateCapDecision(scope, usage);
  if (!rc.ok) {
    return { allowed: false, mode: 'deny', explicit: false, reason: rc.reason, risk, targets, policyMode: 'governed', gate: 'rate' };
  }

  // Target match gate. No targets observed = considered in-scope.
  if (targets.length > 0) {
    const outside = targets.filter((target) => !targetInScope(target, scope));
    if (outside.length > 0) {
      return {
        allowed: false,
        mode: 'deny',
        explicit: false,
        reason: `Target ${outside[0]} is outside selected scope`,
        risk, targets, policyMode: 'governed', gate: 'target',
      };
    }
  }

  // Mode is auto or ask. Ask is "allowed pending approval" — the executor
  // pauses for an operator decision; the action itself isn't blocked yet.
  if (actionResolution.mode === 'ask') {
    return {
      allowed: false, // not yet — pending approval
      mode: 'ask',
      explicit: true,
      reason: `${risk} requires operator approval per scope policy`,
      risk, targets, policyMode: 'governed', gate: null,
    };
  }

  return {
    allowed: true,
    mode: 'auto',
    explicit: true,
    reason: 'Action is inside selected scope',
    risk, targets, policyMode: 'governed', gate: null,
  };
}
