// Rules-of-engagement templates for common engagement types. Each template
// is a partial scope payload — the scope builder offers them as "Start from
// template" presets that pre-fill action modes, time windows, rate caps,
// and ROE notes. Templates are static; operators always edit the resulting
// scope before saving, so these are starting points, not rigid configs.

const TEMPLATES = [
  {
    id: 'internal-pentest',
    name: 'Internal Pentest',
    summary: 'Authorized internal network assessment. Recon + scanning auto, exploit asks, destructive denied.',
    payload: {
      action_modes: {
        'read/local': 'auto',
        'recon': 'auto',
        'network-scan': 'auto',
        'exploit': 'ask',
        'credentialed': 'ask',
        'offline-password-audit': 'ask',
        'online-bruteforce': 'deny',
        'destructive': 'deny',
      },
      active_hours: { windows: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '18:00' }] },
      rate_caps: { requests_per_minute: 60, max_actions_per_run: 500 },
      rules_of_engagement: [
        '• Authorized internal pentest — pre-approved by IT Security.',
        '• Business hours only (Mon–Fri, 09:00–18:00).',
        '• Exploit-class actions require explicit operator approval per call.',
        '• No destructive payloads. No production data exfiltration.',
        '• Stop and notify the operator if a production-impacting finding is observed.',
      ].join('\n'),
    },
  },
  {
    id: 'external-bug-bounty',
    name: 'External Bug Bounty',
    summary: 'Public-facing target with strict per-target rate limits. Recon auto, all else asks.',
    payload: {
      action_modes: {
        'read/local': 'auto',
        'recon': 'auto',
        'network-scan': 'ask',
        'exploit': 'ask',
        'credentialed': 'deny',
        'offline-password-audit': 'deny',
        'online-bruteforce': 'deny',
        'destructive': 'deny',
      },
      rate_caps: { requests_per_minute: 20, max_actions_per_run: 200 },
      rules_of_engagement: [
        '• Public bug-bounty program — respect program policies.',
        '• Honor in-scope/out-of-scope domain lists exactly.',
        '• Low-rate enumeration. Stop at first sign of WAF rate-limit response.',
        '• No account creation/abuse, no DoS, no social engineering.',
        '• Report findings via the program portal — do NOT contact site owners directly.',
      ].join('\n'),
    },
  },
  {
    id: 'red-team',
    name: 'Red Team Engagement',
    summary: 'Long-running adversary emulation. Everything asks; operator drives tempo.',
    payload: {
      action_modes: {
        'read/local': 'auto',
        'recon': 'auto',
        'network-scan': 'ask',
        'exploit': 'ask',
        'credentialed': 'ask',
        'offline-password-audit': 'ask',
        'online-bruteforce': 'ask',
        'destructive': 'deny',
      },
      active_hours: { windows: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start: '00:00', end: '23:59' }] },
      rate_caps: { requests_per_minute: 30, max_actions_per_run: 1000 },
      rules_of_engagement: [
        '• Sanctioned red-team engagement. ROE controlled by named operator.',
        '• Operator drives tempo: every active-action class pauses for approval.',
        '• Maintain low and slow profile to mirror realistic adversary.',
        '• Preserve evidence — every finding must include reproducible commands + artifacts.',
        '• No destructive actions even if exploit succeeds. Establish foothold, document, retreat.',
      ].join('\n'),
    },
  },
  {
    id: 'compliance-audit',
    name: 'Compliance Audit',
    summary: 'Read-only posture verification. Only recon + read; everything else explicitly denied.',
    payload: {
      action_modes: {
        'read/local': 'auto',
        'recon': 'auto',
        'network-scan': 'ask',
        'exploit': 'deny',
        'credentialed': 'deny',
        'offline-password-audit': 'deny',
        'online-bruteforce': 'deny',
        'destructive': 'deny',
      },
      rate_caps: { requests_per_minute: 15, max_actions_per_run: 200 },
      rules_of_engagement: [
        '• Read-only compliance verification (PCI / SOC2 / ISO 27001 style).',
        '• No exploitation, no credentialed access, no traffic generation.',
        '• Network scans only with explicit per-call approval.',
        '• Every finding must map to a named control. Note the control id in the description.',
      ].join('\n'),
    },
  },
  {
    id: 'lab-research',
    name: 'Lab Research',
    summary: 'Isolated lab. Wide-open for offensive research, but trace audit remains on.',
    payload: {
      action_modes: {
        'read/local': 'auto',
        'recon': 'auto',
        'network-scan': 'auto',
        'exploit': 'auto',
        'credentialed': 'auto',
        'offline-password-audit': 'auto',
        'online-bruteforce': 'ask',
        'destructive': 'ask',
      },
      rate_caps: { max_actions_per_run: 2000 },
      rules_of_engagement: [
        '• Isolated lab environment. No production systems on this scope.',
        '• Offensive techniques OK for research and tool validation.',
        '• Destructive and online-bruteforce still pause for approval — easier to recover from a "wait, was that the right host?"',
        '• Save reusable findings into the asset inventory as you go.',
      ].join('\n'),
    },
  },
];

export function getRoeTemplates() {
  return TEMPLATES.map((t) => ({ id: t.id, name: t.name, summary: t.summary, payload: t.payload }));
}

export function getRoeTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}
