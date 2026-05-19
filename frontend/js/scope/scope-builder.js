(function attachScopeBuilder(global) {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Canonical action-class set (mirrors server/scope/policy.js RISKY_RISKS + SAFE_RISKS).
  // Locked rows are policy-mandated and always blocked.
  const ACTION_CLASSES = [
    { id: 'read/local',              risk: 'low',  examples: 'list_directory · read_file · workspace I/O' },
    { id: 'recon',                   risk: 'low',  examples: 'web_request · dns · whois · ct-logs' },
    { id: 'network-scan',            risk: 'med',  examples: 'nmap · masscan · vulners' },
    { id: 'web-vuln',                risk: 'high', examples: 'sqlmap (detect) · nuclei · ffuf' },
    { id: 'credentialed',            risk: 'high', examples: 'auth probes with stored creds reference' },
    { id: 'offline-password-audit',  risk: 'med',  examples: 'hashcat · john · local hashes only' },
    { id: 'online-bruteforce',       risk: 'high', examples: 'hydra · medusa · ncrack (authorized)' },
    { id: 'exploit',                 risk: 'crit', examples: 'msfconsole · payload execution', locked: true },
    { id: 'destructive',             risk: 'crit', examples: 'INSERT/UPDATE/DELETE · file write to target', locked: true },
  ];

  function getActionClasses() { return ACTION_CLASSES.slice(); }

  // Normalize a parsed-targets response into a flat list of { kind, value }.
  // Accepts either { urls, domains, hosts, cidrs, hostPorts } OR an already-flat array.
  function normalizeTargets(parsed) {
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'string') return { kind: 'host', value: item };
        return {
          kind: String(item.kind || item.type || 'host').toLowerCase(),
          value: String(item.value || item.target || ''),
          id: item.id || null,
        };
      }).filter(t => t.value);
    }
    if (!parsed || typeof parsed !== 'object') return [];
    const out = [];
    const KIND_MAP = {
      urls: 'url', url: 'url',
      domains: 'domain', domain: 'domain',
      hosts: 'host', host: 'host',
      cidrs: 'cidr', cidr: 'cidr',
      hostPorts: 'host', host_ports: 'host', 'host-ports': 'host',
      ips: 'host', ip: 'host',
      assetIds: 'asset', assets: 'asset',
    };
    for (const [key, values] of Object.entries(parsed)) {
      const kind = KIND_MAP[key];
      if (!kind || !Array.isArray(values)) continue;
      for (const v of values) {
        if (v == null || v === '') continue;
        out.push({ kind, value: String(v) });
      }
    }
    return out;
  }

  function renderTargetChips(targetsInput = []) {
    const targets = normalizeTargets(targetsInput);
    if (!targets.length) {
      return '<span class="caption" style="color:var(--fg-3);font-family:var(--font-mono);font-size:var(--fs-11);">No targets yet — paste above.</span>';
    }
    return targets.map(target => {
      const kind = (target.kind || 'host').toLowerCase();
      const value = target.value || '';
      const id = target.id || `${kind}:${value}`;
      return `<span class="target-chip" role="listitem" data-target-id="${escapeHtml(id)}" data-kind="${escapeHtml(kind)}" data-value="${escapeHtml(value)}">`
        + `<span class="kind ${escapeHtml(kind)}">${escapeHtml(kind)}</span>`
        + `<span class="val">${escapeHtml(value)}</span>`
        + `<button type="button" class="rm" data-remove-target="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(value)}">×</button>`
        + `</span>`;
    }).join('');
  }

  function renderActionClassTable(state = {}) {
    const allowed = new Set((state.allowed || []).map(s => String(s).toLowerCase()));
    const blocked = new Set((state.blocked || []).map(s => String(s).toLowerCase()));
    return ACTION_CLASSES.map((row) => {
      const locked = row.locked;
      const isAllow = !locked && allowed.has(row.id);
      const isDeny  = locked || blocked.has(row.id);
      const rowCls = locked ? 'action-class-locked' : '';
      const allowCell = locked
        ? `<span class="mono" style="color:var(--policy);font-size:var(--fs-10);">LOCKED</span>`
        : `<input type="checkbox" data-action-allow="${escapeHtml(row.id)}" ${isAllow ? 'checked' : ''} aria-label="Allow ${escapeHtml(row.id)}">`;
      const denyCell = `<input type="checkbox" data-action-deny="${escapeHtml(row.id)}" ${isDeny ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="Deny ${escapeHtml(row.id)}">`;
      return `<tr class="${rowCls}" data-action-class="${escapeHtml(row.id)}">`
        + `<td><span class="mono">${escapeHtml(row.id)}</span><div class="mono" style="color:var(--fg-3);font-size:var(--fs-10);margin-top:2px;">${escapeHtml(row.examples)}</div></td>`
        + `<td><span class="risk-pill ${escapeHtml(row.risk)}">${escapeHtml(row.risk)}</span></td>`
        + `<td class="ck">${allowCell}</td>`
        + `<td class="ck">${denyCell}</td>`
        + `</tr>`;
    }).join('');
  }

  function renderPolicyPreview(decision = null) {
    if (!decision) {
      return '<div class="policy-preview idle">Run a dry-run policy check before launching tools.</div>';
    }
    // Multi-sample decision shape: { allowed: number, blocked: number, samples: [...] }
    if (Array.isArray(decision.samples) || typeof decision.allowed === 'number') {
      const allowed = Number(decision.allowed || 0);
      const blocked = Number(decision.blocked || 0);
      const samples = Array.isArray(decision.samples) ? decision.samples : [];
      const summary = `<div class="policy-summary">`
        + `<div class="cell"><span class="num ok">${allowed}</span><span class="cap">Allowed</span></div>`
        + `<div class="cell"><span class="num block">${blocked}</span><span class="cap">Blocked</span></div>`
        + `</div>`;
      const list = samples.map(s => {
        const cls = s.allowed ? 'allowed' : 'blocked';
        const status = s.allowed ? 'ALLOW' : 'BLOCK';
        return `<div class="policy-preview ${cls}">`
          + `<strong>${escapeHtml(status)}</strong>`
          + `<span class="mono">${escapeHtml(s.risk || s.cls || '—')}</span>`
          + `<span class="mono">${escapeHtml(s.target || s.command || s.reason || '')}</span>`
          + `</div>`;
      }).join('');
      return summary + (list || '<div class="policy-preview idle">No sample actions evaluated.</div>');
    }
    // Single decision shape
    const status = decision.allowed ? 'Allowed' : 'Blocked';
    const cls = decision.allowed ? 'allowed' : 'blocked';
    return `<div class="policy-preview ${cls}">`
      + `<strong>${escapeHtml(status)}</strong>`
      + `<span class="mono">Risk: ${escapeHtml(decision.risk || 'unknown')}</span>`
      + `<p>${escapeHtml(decision.reason || '')}</p>`
      + `<small class="mono">Targets: ${escapeHtml((decision.targets || []).join(', ') || 'none detected')}</small>`
      + `</div>`;
  }

  function templateToDraft(template = {}) {
    return {
      nameSuffix: template.name || 'Custom Scope',
      allowedActions: Array.isArray(template.allowedActions) ? [...template.allowedActions] : [],
      blockedActions: Array.isArray(template.blockedActions) ? [...template.blockedActions] : [],
      notes: template.notes || template.summary || '',
      toolpackIds: Array.isArray(template.toolpackIds) ? [...template.toolpackIds] : [],
    };
  }

  const api = {
    renderTargetChips,
    renderActionClassTable,
    renderPolicyPreview,
    templateToDraft,
    normalizeTargets,
    getActionClasses,
    escapeHtml,
  };
  global.ScopeBuilder = api;
})(typeof window !== 'undefined' ? window : globalThis);
