const SAFE_RISKS = new Set(['read/local']);
const RISKY_RISKS = new Set(['recon', 'network-scan', 'exploit', 'destructive', 'credentialed', 'unknown']);

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const URL_RE = /https?:\/\/[^\s'"<>),]+/gi;
const HOST_PORT_RE = /\b((?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::(\d{1,5}))\b/gi;
const DOMAIN_RE = /\b(?!(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.\d{1,3}){3}\b)(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

function stringifyInput(args) {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try { return JSON.stringify(args); } catch { return String(args); }
}

export function extractTargets(args = {}) {
  const text = stringifyInput(args);
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
    if (!domain.includes('..')) out.add(domain.toLowerCase());
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
    if (/\b(hydra|john|hashcat|sudo|su\s|ssh\s|scp\s|rsync\s|password|passwd|token|credential)\b/.test(text)) return 'credentialed';
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

export function evaluateToolAction({ toolName, args = {}, scope = null, now = new Date() }) {
  const risk = classifyRisk(toolName, args);
  const targets = extractTargets(args);
  if (SAFE_RISKS.has(risk)) return { allowed: true, reason: 'Safe local/read action', risk, targets };
  if (!RISKY_RISKS.has(risk)) return { allowed: false, reason: `Unknown risk class: ${risk}`, risk, targets };
  if (!scope) return { allowed: false, reason: `No selected scope for ${risk} action`, risk, targets };
  if (scope.archived_at) return { allowed: false, reason: `Scope "${scope.name}" is archived`, risk, targets };
  if (scope.expires_at && new Date(scope.expires_at).getTime() < now.getTime()) {
    return { allowed: false, reason: `Scope "${scope.name}" is expired`, risk, targets };
  }
  const blocked = normalizeActions(scope.blocked_actions || scope.blockedActions);
  if (blocked.has(risk)) return { allowed: false, reason: `${risk} is blocked by scope policy`, risk, targets };
  const allowed = normalizeActions(scope.allowed_actions || scope.allowedActions);
  if (allowed.size && !allowed.has(risk)) return { allowed: false, reason: `${risk} is not allowed by selected scope`, risk, targets };
  if (targets.length === 0) return { allowed: true, reason: 'No explicit external target found', risk, targets };
  const outside = targets.filter(target => !targetInScope(target, scope));
  if (outside.length > 0) {
    return { allowed: false, reason: `Target ${outside[0]} is outside selected scope`, risk, targets };
  }
  return { allowed: true, reason: 'Action is inside selected scope', risk, targets };
}
