export const SCOPE_TEMPLATES = [
  {
    id: 'passive-osint',
    name: 'Passive OSINT',
    summary: 'Public-source research with no active scanning by default.',
    allowedActions: ['recon'],
    blockedActions: ['network-scan', 'exploit', 'destructive', 'credentialed'],
    toolpackIds: ['passive-osint', 'reporting'],
    notes: 'Passive OSINT only. Avoid direct probing unless later authorized by scope policy.',
  },
  {
    id: 'web-recon',
    name: 'Web Recon',
    summary: 'Scoped HTTP probing, crawling, and content discovery.',
    allowedActions: ['recon', 'network-scan'],
    blockedActions: ['exploit', 'destructive', 'credentialed'],
    toolpackIds: ['web-recon', 'reporting'],
    notes: 'Safe HTTP reconnaissance only. Do not authenticate, exploit, or mutate state.',
  },
  {
    id: 'network-discovery',
    name: 'Network Discovery',
    summary: 'Scoped host and service discovery for IP/CIDR targets.',
    allowedActions: ['recon', 'network-scan'],
    blockedActions: ['exploit', 'destructive', 'credentialed'],
    toolpackIds: ['network-discovery', 'reporting'],
    notes: 'Rate-conscious network discovery. Inventory services; no exploitation or credential use.',
  },
  {
    id: 'web-vuln-assessment',
    name: 'Web Vulnerability Assessment',
    summary: 'Safe web vulnerability checks and evidence normalization.',
    allowedActions: ['recon', 'network-scan'],
    blockedActions: ['destructive', 'credentialed'],
    toolpackIds: ['web-vuln-assessment', 'reporting'],
    notes: 'Use safe templates by default. Exploit-class tools require explicit policy approval.',
  },
  {
    id: 'offline-password-audit',
    name: 'Offline Password Audit',
    summary: 'Hash identification and offline cracking against provided hashes only.',
    allowedActions: ['credentialed'],
    blockedActions: ['online-bruteforce', 'credential-stuffing', 'spraying', 'destructive'],
    toolpackIds: ['offline-password-audit', 'reporting'],
    notes: 'Offline hash audit only. Never perform online brute force, spraying, or credential stuffing.',
  },
  {
    id: 'reporting',
    name: 'Reporting',
    summary: 'Evidence, findings, executive summaries, and remediation tracking.',
    allowedActions: ['read/local', 'recon'],
    blockedActions: ['destructive'],
    toolpackIds: ['reporting'],
    notes: 'Normalize evidence and redact secrets in all artifacts and findings.',
  },
];

export function getScopeTemplates() {
  return JSON.parse(JSON.stringify(SCOPE_TEMPLATES));
}

export function getScopeTemplate(id) {
  return getScopeTemplates().find(template => template.id === id) || null;
}
