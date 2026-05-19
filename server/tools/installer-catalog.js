// Sec-ops tool catalog for the installer.
//
// Each entry resolves one "logical tool" to its per-backend package id:
//   command   — the binary on PATH after install (used for availability)
//   tier      — base | offensive | blue
//   packages  — { winget, choco, scoop, apt, dnf, pacman, brew, pipx, go, snap }
//   docs      — upstream URL for the operator
//
// Backends fall back gracefully:
//   - On Windows we prefer winget → choco → scoop → wsl-apt
//   - On Debian/Ubuntu/Kali we prefer apt → pipx → go
//   - On Fedora we prefer dnf → pipx → go
//   - On Arch we prefer pacman → pipx → go
//   - On macOS we prefer brew → pipx → go
//
// Tools missing a package id for a given backend simply report
// "no package available on this backend" — the UI surfaces the next-best
// install hint rather than silently failing.

export const TIERS = ['base', 'offensive', 'blue'];

export const TOOLS = [
  // ── Base · governed recon / OSINT ──────────────────────────────────────
  { id: 'nmap',         command: 'nmap',         tier: 'base', summary: 'Service & version discovery (scoped scans).',
    packages: { winget: 'Insecure.Nmap', choco: 'nmap', apt: 'nmap', dnf: 'nmap', pacman: 'nmap', brew: 'nmap' },
    docs: 'https://nmap.org/' },
  { id: 'masscan',      command: 'masscan',      tier: 'base', summary: 'High-rate Internet-scale port scanner.',
    packages: { choco: 'masscan', apt: 'masscan', dnf: 'masscan', pacman: 'masscan', brew: 'masscan' },
    docs: 'https://github.com/robertdavidgraham/masscan' },
  { id: 'ffuf',         command: 'ffuf',         tier: 'base', summary: 'Fast web fuzzer / content discovery.',
    packages: { choco: 'ffuf', apt: 'ffuf', dnf: 'ffuf', pacman: 'ffuf', brew: 'ffuf', go: 'github.com/ffuf/ffuf/v2@latest' },
    docs: 'https://github.com/ffuf/ffuf' },
  { id: 'gobuster',     command: 'gobuster',     tier: 'base', summary: 'Directory/DNS/VHost brute-forcer.',
    packages: { choco: 'gobuster', apt: 'gobuster', dnf: 'gobuster', pacman: 'gobuster', brew: 'gobuster', go: 'github.com/OJ/gobuster/v3@latest' },
    docs: 'https://github.com/OJ/gobuster' },
  { id: 'sqlmap',       command: 'sqlmap',       tier: 'base', summary: 'Automatic SQL injection testing.',
    packages: { choco: 'sqlmap', apt: 'sqlmap', dnf: 'sqlmap', pacman: 'sqlmap', brew: 'sqlmap', pipx: 'sqlmap' },
    docs: 'https://sqlmap.org/' },
  { id: 'nikto',        command: 'nikto',        tier: 'base', summary: 'Web server vulnerability scanner.',
    packages: { choco: 'nikto', apt: 'nikto', pacman: 'nikto', brew: 'nikto' },
    docs: 'https://github.com/sullo/nikto' },
  { id: 'theharvester', command: 'theHarvester', tier: 'base', summary: 'Passive OSINT collector.',
    packages: { apt: 'theharvester', pipx: 'theHarvester' },
    docs: 'https://github.com/laramies/theHarvester' },
  { id: 'amass',        command: 'amass',        tier: 'base', summary: 'In-depth subdomain enumeration.',
    packages: { choco: 'amass', apt: 'amass', dnf: 'amass', pacman: 'amass', brew: 'amass', go: 'github.com/owasp-amass/amass/v4/...@master' },
    docs: 'https://github.com/owasp-amass/amass' },
  { id: 'whatweb',      command: 'whatweb',      tier: 'base', summary: 'Web technology fingerprinter.',
    packages: { apt: 'whatweb', brew: 'whatweb' },
    docs: 'https://github.com/urbanadventurer/WhatWeb' },
  { id: 'httpx',        command: 'httpx',        tier: 'base', summary: 'Fast HTTP probe / surface mapping.',
    packages: { apt: 'httpx-toolkit', brew: 'httpx', go: 'github.com/projectdiscovery/httpx/cmd/httpx@latest' },
    docs: 'https://github.com/projectdiscovery/httpx' },

  // ── Offensive · red team ───────────────────────────────────────────────
  { id: 'metasploit',   command: 'msfconsole',   tier: 'offensive', summary: 'Exploit framework. Heavy install.',
    packages: { choco: 'metasploit', apt: 'metasploit-framework', brew: 'metasploit' },
    docs: 'https://www.metasploit.com/' },
  { id: 'john',         command: 'john',         tier: 'offensive', summary: 'John the Ripper · offline cracker.',
    packages: { choco: 'john', apt: 'john', dnf: 'john', pacman: 'john', brew: 'john' },
    docs: 'https://www.openwall.com/john/' },
  { id: 'hashcat',      command: 'hashcat',      tier: 'offensive', summary: 'GPU-accelerated offline cracker.',
    packages: { choco: 'hashcat', apt: 'hashcat', dnf: 'hashcat', pacman: 'hashcat', brew: 'hashcat' },
    docs: 'https://hashcat.net/hashcat/' },
  { id: 'hydra',        command: 'hydra',        tier: 'offensive', summary: 'Online auth brute-forcer (scoped).',
    packages: { apt: 'hydra', dnf: 'hydra', pacman: 'hydra', brew: 'hydra' },
    docs: 'https://github.com/vanhauser-thc/thc-hydra' },
  { id: 'responder',    command: 'responder',    tier: 'offensive', summary: 'LLMNR/NBT-NS/MDNS poisoner.',
    packages: { apt: 'responder', pipx: 'Responder' },
    docs: 'https://github.com/SpiderLabs/Responder' },
  { id: 'impacket',     command: 'impacket-secretsdump', tier: 'offensive', summary: 'Network protocol Python toolkit.',
    packages: { apt: 'impacket-scripts', pipx: 'impacket' },
    docs: 'https://github.com/fortra/impacket' },
  { id: 'bloodhound',   command: 'bloodhound',   tier: 'offensive', summary: 'AD attack-path graphing.',
    packages: { choco: 'bloodhound', apt: 'bloodhound', brew: 'bloodhound' },
    docs: 'https://github.com/SpecterOps/BloodHound' },

  // ── Blue · defense / DFIR ─────────────────────────────────────────────
  { id: 'wireshark',    command: 'wireshark',    tier: 'blue', summary: 'Network protocol analyzer (GUI + tshark).',
    packages: { winget: 'WiresharkFoundation.Wireshark', choco: 'wireshark', apt: 'wireshark', dnf: 'wireshark', pacman: 'wireshark-qt', brew: 'wireshark' },
    docs: 'https://www.wireshark.org/' },
  { id: 'zeek',         command: 'zeek',         tier: 'blue', summary: 'Network security monitor.',
    packages: { apt: 'zeek', dnf: 'zeek', pacman: 'zeek', brew: 'zeek' },
    docs: 'https://zeek.org/' },
  { id: 'suricata',     command: 'suricata',     tier: 'blue', summary: 'High-perf IDS/IPS.',
    packages: { choco: 'suricata', apt: 'suricata', dnf: 'suricata', pacman: 'suricata', brew: 'suricata' },
    docs: 'https://suricata.io/' },
  { id: 'yara',         command: 'yara',         tier: 'blue', summary: 'Pattern-matching for malware triage.',
    packages: { choco: 'yara', apt: 'yara', dnf: 'yara', pacman: 'yara', brew: 'yara' },
    docs: 'https://virustotal.github.io/yara/' },
  { id: 'volatility',   command: 'vol',          tier: 'blue', summary: 'Memory forensics framework (v3).',
    packages: { apt: 'volatility3', pipx: 'volatility3' },
    docs: 'https://github.com/volatilityfoundation/volatility3' },
  { id: 'chainsaw',     command: 'chainsaw',     tier: 'blue', summary: 'Fast Windows-event-log hunting.',
    packages: { choco: 'chainsaw', brew: 'chainsaw' },
    docs: 'https://github.com/WithSecureLabs/chainsaw' },
];

export function getCatalog() {
  return TOOLS.map((tool) => ({ ...tool, packages: { ...tool.packages } }));
}

export function getToolById(id) {
  return TOOLS.find((tool) => tool.id === id) || null;
}

export function getToolsByTier(tier) {
  return TOOLS.filter((tool) => tool.tier === tier);
}
