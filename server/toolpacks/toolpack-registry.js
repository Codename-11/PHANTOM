import { execFileSync } from 'child_process';

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
    summary: 'Hash identification and offline cracking against user-provided hash material only.',
    category: 'passwords',
    risks: ['credentialed'],
    allowedActions: ['credentialed'],
    blockedByDefault: ['online-bruteforce', 'credential-stuffing', 'spraying', 'destructive'],
    policy: { scopeRequired: true, passiveOnly: false, offlineOnly: true, allowCredentialUse: false },
    tools: [
      { name: 'hashid', command: 'hashid', risk: 'read/local', installHint: 'pipx install hashid', scopeRequired: false, parser: 'hash_types' },
      { name: 'name-that-hash', command: 'nth', risk: 'read/local', installHint: 'pipx install name-that-hash', scopeRequired: false, parser: 'hash_types' },
      { name: 'john', command: 'john', risk: 'credentialed', installHint: 'sudo apt install john', scopeRequired: true, parser: 'cracked_summary' },
      { name: 'hashcat', command: 'hashcat', risk: 'credentialed', installHint: 'sudo apt install hashcat', scopeRequired: true, parser: 'cracked_summary' },
    ],
    prompt: 'Offline Password Audit: identify hash types and assess password strength only against provided hashes. Never perform online brute force, credential stuffing, password spraying, or live login attempts unless a future explicit policy permits them.',
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

function defaultCommandExists(command) {
  try {
    execFileSync('bash', ['-lc', `command -v ${String(command).replace(/[^a-zA-Z0-9._-]/g, '')}`], { stdio: 'ignore', timeout: 1500 });
    return true;
  } catch {
    return false;
  }
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
    sections.push([
      `### ${pack.name}`,
      pack.summary,
      `Allowed risk classes: ${pack.allowedActions.join(', ') || 'none'}`,
      `Blocked by default: ${pack.blockedByDefault.join(', ') || 'none'}`,
      `Tools: ${pack.tools.map(tool => `${tool.name}(${tool.risk})`).join(', ')}`,
      `Playbook: ${pack.prompt}`,
    ].join('\n'));
  }
  return sections.join('\n\n');
}
