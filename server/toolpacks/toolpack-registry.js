import { existsSync, statSync } from 'fs';
import { join, delimiter } from 'path';
import { platform } from 'os';

const TOOLPACKS = [
  {
    id: 'passive-osint',
    name: 'Passive OSINT',
    summary: 'Public-source discovery that avoids direct probing unless a scoped URL is explicitly selected.',
    category: 'osint',
    risks: ['recon'],
    allowedActions: ['recon'],
    blockedByDefault: ['network-scan', 'exploit', 'destructive', 'credentialed', 'online-bruteforce'],
    policy: { scopeRequired: false, passiveOnly: true, allowNetworkScan: false, allowCredentialUse: false },
    tools: [
      { name: 'dig', command: 'dig', risk: 'recon', installHint: 'sudo apt install dnsutils', scopeRequired: false, parser: 'dns_records' },
      { name: 'whois', command: 'whois', risk: 'recon', installHint: 'sudo apt install whois', scopeRequired: false, parser: 'whois_text' },
      { name: 'subfinder', command: 'subfinder', risk: 'recon', installHint: 'go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest', scopeRequired: true, parser: 'line_domains' },
      { name: 'theHarvester', command: 'theHarvester', risk: 'recon', installHint: 'pipx install theHarvester', scopeRequired: true, parser: 'harvester_json' },
      { name: 'exiftool', command: 'exiftool', risk: 'read/local', installHint: 'sudo apt install libimage-exiftool-perl', scopeRequired: false, parser: 'metadata_redacted' },
    ],
    prompt: 'Use passive public-source techniques first. Do not authenticate, spray, scrape private data, or contact out-of-scope infrastructure. Summarize sources and confidence.',
  },
  {
    id: 'web-recon',
    name: 'Web Recon',
    summary: 'HTTP surface mapping, screenshots/crawling hints, and safe web enumeration for scoped web targets.',
    category: 'web',
    risks: ['recon', 'network-scan'],
    allowedActions: ['recon', 'network-scan'],
    blockedByDefault: ['exploit', 'destructive', 'credentialed', 'online-bruteforce'],
    policy: { scopeRequired: true, passiveOnly: false, allowNetworkScan: true, allowCredentialUse: false },
    tools: [
      { name: 'httpx', command: 'httpx', risk: 'network-scan', installHint: 'go install github.com/projectdiscovery/httpx/cmd/httpx@latest', scopeRequired: true, parser: 'httpx_json' },
      { name: 'katana', command: 'katana', risk: 'network-scan', installHint: 'go install github.com/projectdiscovery/katana/cmd/katana@latest', scopeRequired: true, parser: 'urls' },
      { name: 'gau', command: 'gau', risk: 'recon', installHint: 'go install github.com/lc/gau/v2/cmd/gau@latest', scopeRequired: true, parser: 'urls' },
      { name: 'ffuf', command: 'ffuf', risk: 'network-scan', installHint: 'sudo apt install ffuf', scopeRequired: true, parser: 'ffuf_json' },
      { name: 'wafw00f', command: 'wafw00f', risk: 'recon', installHint: 'pipx install wafw00f', scopeRequired: true, parser: 'waf_detection' },
    ],
    prompt: 'Map scoped HTTP services, prefer HEAD/GET and low-rate enumeration, capture evidence, and avoid state-changing requests unless the scope explicitly allows them.',
  },
  {
    id: 'network-discovery',
    name: 'Network Discovery',
    summary: 'Host/service inventory for explicitly scoped IPs and CIDRs.',
    category: 'network',
    risks: ['network-scan'],
    allowedActions: ['network-scan', 'recon'],
    blockedByDefault: ['exploit', 'destructive', 'credentialed', 'online-bruteforce'],
    policy: { scopeRequired: true, passiveOnly: false, allowNetworkScan: true, allowCredentialUse: false },
    tools: [
      { name: 'nmap', command: 'nmap', risk: 'network-scan', installHint: 'sudo apt install nmap', scopeRequired: true, parser: 'nmap_xml_or_text' },
      { name: 'naabu', command: 'naabu', risk: 'network-scan', installHint: 'go install github.com/projectdiscovery/naabu/v2/cmd/naabu@latest', scopeRequired: true, parser: 'ports' },
      { name: 'rustscan', command: 'rustscan', risk: 'network-scan', installHint: 'cargo install rustscan', scopeRequired: true, parser: 'ports' },
      { name: 'nc', command: 'nc', risk: 'recon', installHint: 'sudo apt install netcat-openbsd', scopeRequired: true, parser: 'banner' },
    ],
    prompt: 'Perform scoped, rate-conscious discovery. Favor service/version inventory and deltas; do not exploit, authenticate, or brute-force discovered services.',
  },
  {
    id: 'web-vuln-assessment',
    name: 'Web Vulnerability Assessment',
    summary: 'Safe web vulnerability assessment with template selection and evidence-first findings.',
    category: 'vulnerability',
    risks: ['network-scan', 'exploit'],
    allowedActions: ['recon', 'network-scan'],
    blockedByDefault: ['destructive', 'credentialed', 'online-bruteforce'],
    policy: { scopeRequired: true, passiveOnly: false, allowNetworkScan: true, allowExploit: false, allowCredentialUse: false },
    tools: [
      { name: 'nuclei', command: 'nuclei', risk: 'network-scan', installHint: 'go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest', scopeRequired: true, parser: 'nuclei_json' },
      { name: 'nikto', command: 'nikto', risk: 'network-scan', installHint: 'sudo apt install nikto', scopeRequired: true, parser: 'nikto_text' },
      { name: 'testssl.sh', command: 'testssl.sh', risk: 'network-scan', installHint: 'git clone https://github.com/drwetter/testssl.sh ~/tools/testssl.sh', scopeRequired: true, parser: 'tls_findings' },
      { name: 'sqlmap', command: 'sqlmap', risk: 'exploit', installHint: 'sudo apt install sqlmap', scopeRequired: true, parser: 'sqlmap_text', gated: true },
    ],
    prompt: 'Use safe templates by default. Treat exploit-class checks as gated: explain why they are needed and require explicit scope policy before execution.',
  },
  {
    id: 'offline-password-audit',
    name: 'Offline Password Audit',
    summary: 'Hash identification and offline cracking against user-provided hash material only. Local hash files and wordlists are inputs, not remote scope targets.',
    category: 'passwords',
    risks: ['offline-password-audit'],
    allowedActions: ['offline-password-audit', 'read/local'],
    blockedByDefault: ['online-bruteforce', 'credential-stuffing', 'spraying', 'destructive'],
    defaultLevel: 'basic',
    levels: {
      basic: {
        name: 'Basic',
        description: 'Built-in/off-the-shelf local audit: identify hashes, run John with a small supplied/generated list, and summarize password-strength findings.',
        tools: ['hashid', 'name-that-hash', 'john'],
        wordlists: ['operator-supplied list', 'small generated candidate list'],
      },
      kali: {
        name: 'Kali',
        description: 'Kali-style offline audit using John/Hashcat plus standard local wordlists and rule-based cracking when available.',
        tools: ['hashid', 'name-that-hash', 'john', 'hashcat'],
        wordlists: ['/usr/share/wordlists/rockyou.txt', '/usr/share/seclists/Passwords/', 'operator-supplied list'],
      },
    },
    policy: { scopeRequired: true, targetRequired: false, passiveOnly: false, offlineOnly: true, allowCredentialUse: true, allowOnlineLogin: false },
    tools: [
      { name: 'hashid', command: 'hashid', risk: 'read/local', installHint: 'pipx install hashid', scopeRequired: false, parser: 'hash_types', level: 'basic' },
      { name: 'name-that-hash', command: 'nth', risk: 'read/local', installHint: 'pipx install name-that-hash', scopeRequired: false, parser: 'hash_types', level: 'basic' },
      { name: 'john', command: 'john', risk: 'offline-password-audit', installHint: 'sudo apt install john wordlists', scopeRequired: true, parser: 'cracked_summary', level: 'basic' },
      { name: 'hashcat', command: 'hashcat', risk: 'offline-password-audit', installHint: 'sudo apt install hashcat seclists', scopeRequired: true, parser: 'cracked_summary', level: 'kali' },
    ],
    prompt: 'Offline Password Audit: identify hash types and assess password strength only against provided local hash material. Wordlists such as rockyou.txt, SecLists, or operator-generated candidates are local inputs and should not be treated as remote scope targets. Start at Basic unless the operator selects/requests Kali-level depth. Never perform online brute force, credential stuffing, password spraying, or live login attempts under this toolpack.',
  },
  {
    id: 'credentialed-service-audit',
    name: 'Credentialed Service Audit',
    summary: 'Authorized online authentication testing for explicitly scoped services, separate from offline hash cracking.',
    category: 'passwords',
    risks: ['online-bruteforce'],
    allowedActions: ['online-bruteforce'],
    blockedByDefault: ['credential-stuffing', 'spraying', 'destructive'],
    defaultLevel: 'basic',
    levels: {
      basic: {
        name: 'Basic',
        description: 'Low-volume validation against known scoped services with supplied usernames/password candidates and conservative rates.',
        tools: ['smbclient', 'ssh', 'curl'],
        wordlists: ['operator-supplied tiny candidate list'],
      },
      kali: {
        name: 'Kali',
        description: 'Kali-style online auth testing with Hydra/Medusa/Ncrack when the target and online-bruteforce action class are explicitly in scope.',
        tools: ['hydra', 'medusa', 'ncrack'],
        wordlists: ['/usr/share/wordlists/rockyou.txt', '/usr/share/seclists/Passwords/', 'operator-supplied list'],
      },
    },
    policy: { scopeRequired: true, targetRequired: true, passiveOnly: false, offlineOnly: false, allowCredentialUse: true, allowOnlineLogin: true, requireRateLimit: true },
    tools: [
      { name: 'smbclient', command: 'smbclient', risk: 'online-bruteforce', installHint: 'sudo apt install smbclient', scopeRequired: true, parser: 'auth_attempt_summary', level: 'basic' },
      { name: 'hydra', command: 'hydra', risk: 'online-bruteforce', installHint: 'sudo apt install hydra', scopeRequired: true, parser: 'hydra_summary', level: 'kali', gated: true },
      { name: 'medusa', command: 'medusa', risk: 'online-bruteforce', installHint: 'sudo apt install medusa', scopeRequired: true, parser: 'auth_attempt_summary', level: 'kali', gated: true },
      { name: 'ncrack', command: 'ncrack', risk: 'online-bruteforce', installHint: 'sudo apt install ncrack', scopeRequired: true, parser: 'auth_attempt_summary', level: 'kali', gated: true },
    ],
    prompt: 'Credentialed Service Audit: only run online authentication tests against explicitly scoped services with authorization, low rates, and clear stop conditions. Basic level uses tiny supplied candidate lists. Kali level may use Hydra/Medusa/Ncrack and larger local wordlists only when scope allows online-bruteforce for the target. Do not spray unrelated users, reuse leaked credentials, or test out-of-scope services.',
  },
  {
    id: 'reporting',
    name: 'Reporting',
    summary: 'Normalize evidence into findings, executive summaries, remediation plans, and before/after comparisons.',
    category: 'reporting',
    risks: ['read/local'],
    allowedActions: ['read/local', 'recon'],
    blockedByDefault: ['destructive'],
    policy: { scopeRequired: false, passiveOnly: true, allowCredentialUse: false },
    tools: [
      { name: 'pandoc', command: 'pandoc', risk: 'read/local', installHint: 'sudo apt install pandoc', scopeRequired: false, parser: 'document' },
      { name: 'jq', command: 'jq', risk: 'read/local', installHint: 'sudo apt install jq', scopeRequired: false, parser: 'json' },
    ],
    prompt: 'Turn observations into concise findings with evidence, severity rationale, remediation, affected assets, and before/after comparison notes. Redact secrets in all outputs.',
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Pure-Node PATH walk to detect whether a command is invocable.
 *
 * The previous implementation spawned `bash -lc 'command -v <tool>'` for
 * each toolpack tool. On Windows, when bash.exe isn't on PATH, libuv's
 * CreateProcess failure prints "The system cannot find the path
 * specified." to the parent's stderr *before* the thrown JS error
 * reaches our try/catch — so `stdio:'ignore'` plus a swallowed throw
 * still left dozens of noise lines in `npm run dev` output.
 *
 * Walking PATH directly:
 *   • avoids the subprocess entirely (no noise, ~50× faster)
 *   • respects platform-specific executable extensions on Windows
 *   • caches lookups so repeated /api/toolpacks calls are O(1) per tool
 */
const IS_WIN = platform() === 'win32';
const PATH_EXTS = IS_WIN
  ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.toLowerCase())
  : [''];
const _commandCache = new Map();

function defaultCommandExists(command) {
  const safe = String(command).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return false;
  if (_commandCache.has(safe)) return _commandCache.get(safe);

  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of PATH_EXTS) {
      const candidate = join(dir, safe + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          _commandCache.set(safe, true);
          return true;
        }
      } catch { /* permission errors / symlink loops — skip */ }
    }
  }
  _commandCache.set(safe, false);
  return false;
}

/**
 * Test-only — clears the executable lookup cache so unit tests can
 * exercise different PATH states without stale memoized results.
 */
export function _resetCommandCache() {
  _commandCache.clear();
}

export function getToolpacks() {
  return clone(TOOLPACKS);
}

export function getToolpack(id) {
  const pack = TOOLPACKS.find(item => item.id === id);
  return pack ? clone(pack) : null;
}

export function normalizeToolpackIds(ids = []) {
  const list = Array.isArray(ids) ? ids : String(ids || '').split(',');
  const valid = new Set(TOOLPACKS.map(pack => pack.id));
  return [...new Set(list.map(id => String(id).trim()).filter(id => valid.has(id)))];
}

export function checkToolpackAvailability(id, { commandExists = defaultCommandExists } = {}) {
  const pack = getToolpack(id);
  if (!pack) return null;
  return {
    ...pack,
    tools: pack.tools.map(tool => ({
      ...tool,
      available: !!commandExists(tool.command),
    })),
  };
}

export function buildToolpackPrompt(ids = []) {
  const selected = normalizeToolpackIds(ids).map(getToolpack).filter(Boolean);
  if (!selected.length) return '';
  const sections = ['## SELECTED SECURITY TOOLPACKS'];
  for (const pack of selected) {
    const levelText = pack.levels ? [
      'Capability levels:',
      ...Object.entries(pack.levels).map(([key, level]) => `- ${level.name || key}${pack.defaultLevel === key ? ' (default)' : ''}: ${level.description || ''} Tools: ${(level.tools || []).join(', ') || 'n/a'}. Wordlists: ${(level.wordlists || []).join(', ') || 'n/a'}.`),
    ].join('\n') : '';
    sections.push([
      `### ${pack.name}`,
      pack.summary,
      `Allowed risk classes: ${pack.allowedActions.join(', ') || 'none'}`,
      `Blocked by default: ${pack.blockedByDefault.join(', ') || 'none'}`,
      `Tools: ${pack.tools.map(tool => `${tool.name}(${tool.risk}${tool.level ? `/${tool.level}` : ''})`).join(', ')}`,
      levelText,
      `Playbook: ${pack.prompt}`,
    ].filter(Boolean).join('\n'));
  }
  return sections.join('\n\n');
}
