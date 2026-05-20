// Approvals page — audit dashboard for every gate decision.
//
// Reads /api/approvals + /api/approvals/stats + /api/installer/requests.
// Surfaces a KPI strip with counts by decision (granted/denied/timeout/
// override/allow-once), a 14-day sparkline, and a filterable list of
// events.
//
// A3 — Approval explainability:
//   - Each pending install / scope event renders the structured fields
//     produced by server/approvals/explain.js (target, riskClass,
//     actionClass, policyReason, expectedEffect, sideEffects).
//   - The raw JSON disclosure moves into a collapsed <details> block.
//   - High|crit denials require an operator note before submission.
//   - Stale / resolved approvals have disabled controls + a visible
//     status badge.

const HIGH_RISK_CLASSES = new Set([
  'exploit', 'destructive', 'online-bruteforce', 'offline-password-audit', 'credentialed',
]);

window.ApprovalsPage = {
  events: [],
  stats: null,
  installRequests: [],
  installExplained: [],
  approvalsExplained: [],
  filter: { decision: '', risk: '', since: null },
  _wired: false,

  init() {
    if (this._wired) return;
    this._wired = true;
    document.getElementById('approvals-refresh-btn')?.addEventListener('click', () => this.load());
    document.getElementById('approvals-filter-decision')?.addEventListener('change', (e) => {
      this.filter.decision = e.target.value || '';
      this.load();
    });
    document.getElementById('approvals-filter-risk')?.addEventListener('change', (e) => {
      this.filter.risk = e.target.value || '';
      this.load();
    });
    document.getElementById('approvals-filter-since')?.addEventListener('change', (e) => {
      this.filter.since = e.target.value || null;
      this.load();
    });
  },

  show() {
    this.init();
    this.load();
  },

  async load() {
    const listEl = document.getElementById('approvals-list');
    if (listEl) listEl.innerHTML = '<div class="empty-msg">Loading approvals…</div>';
    try {
      const sinceIso = this.filter.since
        ? new Date(this.filter.since).toISOString()
        : null;
      const params = new URLSearchParams({ limit: '200' });
      if (this.filter.decision) params.set('decision', this.filter.decision);
      if (this.filter.risk) params.set('risk', this.filter.risk);
      if (sinceIso) params.set('since', sinceIso);
      // Pending install requests share this queue — fetched alongside
      // approval events so the Approvals page is the one place an
      // operator looks to triage every governance-gated action.
      const [eventsRes, statsRes, installsRes] = await Promise.all([
        fetch(`/api/approvals?${params.toString()}`).then((r) => r.json()),
        fetch(`/api/approvals/stats${sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : ''}`).then((r) => r.json()),
        fetch('/api/installer/requests?status=pending&limit=20&explained=1').then((r) => r.json()).catch(() => ({ requests: [], explained: [] })),
      ]);
      this.events = Array.isArray(eventsRes?.events) ? eventsRes.events : [];
      this.approvalsExplained = Array.isArray(eventsRes?.explained) ? eventsRes.explained : [];
      this.stats = statsRes;
      if (Array.isArray(installsRes)) {
        // Old-shape fallback when the /api change hasn't rolled out yet.
        this.installRequests = installsRes;
        this.installExplained = [];
      } else {
        this.installRequests = Array.isArray(installsRes?.requests) ? installsRes.requests : [];
        this.installExplained = Array.isArray(installsRes?.explained) ? installsRes.explained : [];
      }
      this.renderKpis();
      this.renderSparkline();
      this.renderRiskBreakdown();
      this.renderInstallRequests();
      this.renderEventList();
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div class="empty-msg danger">Failed to load: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderKpis() {
    const host = document.getElementById('approvals-kpi');
    if (!host) return;
    const s = this.stats?.byDecision || {};
    const total = this.stats?.total || 0;
    const approveRate = total ? Math.round(100 * ((s.granted || 0) + (s['allow-once'] || 0)) / total) : 0;
    host.innerHTML = `
      <div class="stat"><span class="stat-label">Total</span><span class="stat-value">${total}</span><span class="stat-delta">events</span></div>
      <div class="stat ok"><span class="stat-label">Granted</span><span class="stat-value">${s.granted || 0}</span><span class="stat-delta">ask gates</span></div>
      <div class="stat crit"><span class="stat-label">Denied</span><span class="stat-value">${s.denied || 0}</span><span class="stat-delta">${s.timeout || 0} timeouts</span></div>
      <div class="stat cy"><span class="stat-label">Allow-once</span><span class="stat-value">${s['allow-once'] || 0}</span><span class="stat-delta">one-time overrides</span></div>
      <div class="stat high"><span class="stat-label">Override</span><span class="stat-value">${s.override || 0}</span><span class="stat-delta">operator override</span></div>
      <div class="stat"><span class="stat-label">Approve rate</span><span class="stat-value">${approveRate}%</span><span class="stat-delta">granted ÷ total</span></div>
    `;
  },

  renderSparkline() {
    const host = document.getElementById('approvals-sparkline');
    if (!host) return;
    const series = this.stats?.series || [];
    if (!series.length) { host.innerHTML = ''; return; }
    const max = Math.max(1, ...series.map((d) => d.count));
    const bars = series.map((d) => {
      const h = Math.max(2, Math.round(28 * (d.count / max)));
      return `<span class="spark-bar" style="height:${h}px" title="${this.escapeHtml(d.day)} · ${d.count}"></span>`;
    }).join('');
    host.innerHTML = `<span class="spark-label">Last 14 days</span><div class="spark-row">${bars}</div>`;
  },

  // Pending install requests — render using the A3 explained shape so the
  // operator sees plain-language target / policy reason / side effects
  // before approving anything.
  renderInstallRequests() {
    const section = document.getElementById('approvals-installs-section');
    const sub = document.getElementById('approvals-installs-sub');
    const host = document.getElementById('approvals-installs-list');
    if (!section || !host) return;
    if (!this.installRequests.length) {
      section.setAttribute('hidden', '');
      return;
    }
    section.removeAttribute('hidden');
    if (sub) sub.textContent = `${this.installRequests.length} AWAITING APPROVAL`;
    host.innerHTML = this.installRequests.map((r) => {
      const explained = this.installExplained.find((e) => e && e.id === r.id) || this.fallbackInstallExplain(r);
      return this.renderApprovalCard(explained, r, 'install');
    }).join('');
    host.querySelectorAll('[data-install-approve]').forEach((el) => {
      el.addEventListener('click', () => this.approveInstall(el.dataset.installApprove, el));
    });
    host.querySelectorAll('[data-install-cancel]').forEach((el) => {
      el.addEventListener('click', () => this.cancelInstall(el.dataset.installCancel, el));
    });
  },

  // Fallback explainer when the server didn't return /explained=1 yet —
  // keeps the UI alive while the backend rolls out.
  fallbackInstallExplain(r) {
    const installable = (r.plan || []).filter((p) => p?.backend).length;
    const backends = [...new Set((r.plan || []).filter(p => p?.backend).map(p => p.backend))];
    return {
      id: r.id,
      type: 'install',
      target: `packages:${(r.toolIds || []).slice(0, 3).join(',')}`,
      riskClass: 'credentialed',
      actionClass: backends.length === 1 ? `install.${backends[0]}` : 'install.unknown',
      policyReason: `Installing ${installable} security tool${installable === 1 ? '' : 's'} via ${backends.join(' / ') || 'a system package manager'} requires elevated privileges and explicit operator approval.`,
      expectedEffect: `Installs ${installable} security tool${installable === 1 ? '' : 's'}${backends.length ? ` via ${backends.join(' / ')}` : ''}.`,
      sideEffects: [
        'Invokes a system package manager.',
        'Requires elevated privileges (sudo / admin).',
        'Downloads packages from upstream repositories.',
      ],
      rawDetails: r,
      createdAt: r.requested_at,
      status: r.status === 'pending' ? 'pending' : (r.status === 'cancelled' || r.status === 'failed' ? 'denied' : 'approved'),
      denialReason: r.denial_reason || null,
    };
  },

  // ─── A3 — Approval card ────────────────────────────────────────────────
  //
  // Unified renderer for install + scope cards. Shows the structured
  // fields up front and tucks raw JSON inside a collapsed <details>.
  // For high|crit denials a note input is rendered; submission is blocked
  // until the operator types a reason.
  renderApprovalCard(explained, raw, kind) {
    const isResolved = explained.status !== 'pending';
    const needsNote = HIGH_RISK_CLASSES.has(String(explained.riskClass || '').toLowerCase());
    const riskClass = String(explained.riskClass || 'unknown').toLowerCase();
    const idAttr = this.escapeAttribute(explained.id || '');
    const statusBadge = this.renderStatusBadge(explained);
    const targetText = this.escapeHtml(explained.target || 'unspecified');
    const denialReasonRow = explained.denialReason
      ? `<div class="a3-row"><span class="lbl">DENIED</span><span class="a3-row-text">${this.escapeHtml(explained.denialReason)}</span></div>`
      : '';
    const sideFx = (explained.sideEffects || []).map((s) => `<li>${this.escapeHtml(s)}</li>`).join('');
    const noteInput = !isResolved && needsNote
      ? `
        <div class="a3-note-row">
          <label class="a3-note-label">
            <span class="lbl">DENIAL NOTE</span>
            <small>Required for ${this.escapeHtml(riskClass.toUpperCase())} denials</small>
          </label>
          <textarea class="a3-note-input" data-approval-note="${idAttr}" rows="2"
            placeholder="Why is this being denied? (required)"></textarea>
        </div>`
      : '';
    const actionsHtml = isResolved
      ? `<div class="a3-actions"><span class="approval-card-status">${this.escapeHtml((explained.status || '').toUpperCase())}</span></div>`
      : (kind === 'install'
        ? `<div class="a3-actions">
            <button class="btn btn-secondary btn-sm a3-deny" data-install-cancel="${idAttr}">Deny</button>
            <button class="btn btn-primary btn-sm" data-install-approve="${idAttr}">Approve &amp; install</button>
          </div>`
        : `<div class="a3-actions"><span class="approval-card-status">${this.escapeHtml((explained.status || '').toUpperCase())}</span></div>`);

    const rawJson = this.escapeHtml(JSON.stringify(raw ?? explained.rawDetails ?? explained, null, 2));
    const createdAgo = explained.createdAt ? this.timeAgo(explained.createdAt) : '';
    const typeLabel = this.escapeHtml(String(explained.type || kind || 'approval').toUpperCase());

    return `
      <article class="a3-approval-card approval-${this.escapeAttribute(explained.status)} ${isResolved ? 'is-resolved' : ''}" data-approval-id="${idAttr}">
        <header class="a3-hd">
          <span class="a3-kind">${typeLabel}</span>
          <span class="approval-card-risk risk-${this.escapeAttribute(riskClass)}">${this.escapeHtml(riskClass.toUpperCase())}</span>
          <strong class="a3-target" title="${targetText}">${targetText}</strong>
          ${statusBadge}
          <span class="a3-grow"></span>
          ${createdAgo ? `<small class="a3-when">${this.escapeHtml(createdAgo)}</small>` : ''}
        </header>
        <div class="a3-bd">
          <div class="a3-row"><span class="lbl">ACTION</span><code class="a3-row-code">${this.escapeHtml(explained.actionClass || '—')}</code></div>
          <div class="a3-row"><span class="lbl">REASON</span><span class="a3-row-text">${this.escapeHtml(explained.policyReason || '—')}</span></div>
          <div class="a3-row"><span class="lbl">EFFECT</span><span class="a3-row-text">${this.escapeHtml(explained.expectedEffect || '—')}</span></div>
          ${sideFx ? `<div class="a3-row a3-row-list"><span class="lbl">SIDE FX</span><ul class="a3-side-effects">${sideFx}</ul></div>` : ''}
          ${denialReasonRow}
        </div>
        ${noteInput}
        ${actionsHtml}
        <details class="a3-raw-details">
          <summary>Raw details</summary>
          <pre class="a3-raw-json">${rawJson}</pre>
        </details>
      </article>
    `;
  },

  renderStatusBadge(explained) {
    const status = String(explained.status || 'pending').toLowerCase();
    const map = {
      pending: { cls: 'a3-status-pending', label: '⌛ PENDING' },
      approved: { cls: 'a3-status-approved', label: '✓ APPROVED' },
      denied: { cls: 'a3-status-denied', label: '✗ DENIED' },
    };
    const entry = map[status] || map.pending;
    return `<span class="a3-status ${entry.cls}">${entry.label}</span>`;
  },

  async approveInstall(id, btn) {
    if (!confirm('Run the install commands now? Each step runs sequentially.')) return;
    const original = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
    try {
      const res = await fetch(`/api/installer/requests/${encodeURIComponent(id)}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.load();
    } catch (err) {
      alert(`Approve failed: ${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = original; }
    }
  },

  async cancelInstall(id, btn) {
    // A3 — installs are always credentialed (high-risk); harvest the
    // operator-supplied denial note before posting.
    const noteEl = document.querySelector(`[data-approval-note="${this.escapeAttribute(id)}"]`);
    const denialReason = noteEl ? noteEl.value.trim() : '';
    if (!denialReason) {
      alert('A denial note is required for credentialed actions. Please describe why this install is being denied.');
      noteEl?.focus();
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
    try {
      const res = await fetch(`/api/installer/requests/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ denialReason }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message || detail.error || `HTTP ${res.status}`);
      }
      await this.load();
    } catch (err) {
      alert(`Cancel failed: ${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = 'Deny'; }
    }
  },

  renderRiskBreakdown() {
    const host = document.getElementById('approvals-by-risk');
    if (!host) return;
    const byRisk = this.stats?.byRisk || {};
    const entries = Object.entries(byRisk).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { host.innerHTML = '<div class="empty-msg">No approvals recorded yet.</div>'; return; }
    const total = entries.reduce((sum, [, n]) => sum + n, 0) || 1;
    host.innerHTML = entries.map(([risk, n]) => {
      const pct = Math.round(100 * n / total);
      return `<div class="risk-bar-row">`
        + `<span class="risk-bar-label">${this.escapeHtml(risk)}</span>`
        + `<div class="risk-bar"><i style="width:${pct}%"></i></div>`
        + `<span class="risk-bar-count">${n}</span>`
        + `</div>`;
    }).join('');
  },

  renderEventList() {
    const host = document.getElementById('approvals-list');
    if (!host) return;
    if (!this.events.length) { host.innerHTML = '<div class="empty-msg">No approvals match the current filter.</div>'; return; }
    host.innerHTML = this.events.map((e) => this.renderEventRow(e)).join('');
    // Expand toggles
    host.querySelectorAll('.approval-row-summary').forEach((el) => {
      el.addEventListener('click', () => el.closest('.approval-row').classList.toggle('expanded'));
    });
    // Open-run links
    host.querySelectorAll('[data-open-run]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const runId = el.dataset.openRun;
        if (window.RunsPage) window.RunsPage.selectedRunId = runId;
        window.Router?.navigate?.('runs');
        window.RunsPage?.loadRuns?.(runId);
      });
    });
  },

  renderEventRow(e) {
    const decisionClass = ({
      granted: 'granted',
      denied: 'denied',
      'allow-once': 'allow-once',
      override: 'override',
      timeout: 'timeout',
    })[e.decision] || 'unknown';
    const decisionLabel = ({
      granted: '✓ APPROVED',
      denied: '✗ DENIED',
      'allow-once': '⚡ ALLOW ONCE',
      override: '⚠ OVERRIDE',
      timeout: '⌛ TIMED OUT',
    })[e.decision] || e.decision;
    // A3 — try to pull the explained row produced by the server for this
    // event so we can show the human-readable policy reason / effect /
    // side effects in the expanded body without recomputing on the client.
    const explained = (this.approvalsExplained || []).find((row) => row && row.id === e.id);
    const ago = this.timeAgo(e.occurredAt);
    const args = e.args
      ? `<pre>${this.escapeHtml(JSON.stringify(e.args, null, 2))}</pre>`
      : '<small class="caption">(no args)</small>';
    const explainedRows = explained ? `
      <div class="a3-event-meta">
        <div class="a3-row"><span class="lbl">TARGET</span><span class="a3-row-text">${this.escapeHtml(explained.target)}</span></div>
        <div class="a3-row"><span class="lbl">EFFECT</span><span class="a3-row-text">${this.escapeHtml(explained.expectedEffect)}</span></div>
        <div class="a3-row a3-row-list"><span class="lbl">SIDE FX</span><ul class="a3-side-effects">${(explained.sideEffects || []).map(s => `<li>${this.escapeHtml(s)}</li>`).join('')}</ul></div>
        ${explained.denialReason ? `<div class="a3-row"><span class="lbl">NOTE</span><span class="a3-row-text">${this.escapeHtml(explained.denialReason)}</span></div>` : ''}
      </div>
    ` : '';

    return `
      <div class="approval-row decision-${decisionClass}">
        <button type="button" class="approval-row-summary">
          <span class="approval-row-decision">${this.escapeHtml(decisionLabel)}</span>
          <span class="approval-row-tool"><strong>${this.escapeHtml(e.toolName || 'tool')}</strong></span>
          <span class="approval-row-risk">${this.escapeHtml(String(e.risk || '').toUpperCase())}</span>
          <span class="approval-row-scope">${this.escapeHtml(e.scopeName || e.scopeId || '—')}</span>
          <span class="approval-row-when">${this.escapeHtml(ago)}</span>
        </button>
        <div class="approval-row-body">
          <div class="approval-row-meta">
            <div><span class="lbl">REASON</span><span>${this.escapeHtml(e.reason || '—')}</span></div>
            <div><span class="lbl">NOTE</span><span>${this.escapeHtml(e.operatorNote || '—')}</span></div>
            <div><span class="lbl">RUN</span><a href="#runs" data-open-run="${this.escapeAttribute(e.runId)}">${this.escapeHtml(e.runTitle || e.runId || '—')}</a></div>
            <div><span class="lbl">POLICY</span><span>${this.escapeHtml(e.policyMode || '—')}</span></div>
            ${e.gate ? `<div><span class="lbl">GATE</span><span>${this.escapeHtml(e.gate)}</span></div>` : ''}
          </div>
          ${explainedRows}
          <details class="a3-raw-details">
            <summary>Raw details</summary>
            <div class="approval-row-args">${args}</div>
          </details>
        </div>
      </div>
    `;
  },

  timeAgo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const mins = (Date.now() - t) / 60000;
    if (mins < 0) return '';
    if (mins < 1) return 'just now';
    if (mins < 60) return `${Math.round(mins)}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  },

  escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  },

  escapeAttribute(value) {
    return this.escapeHtml(value).replace(/"/g, '&quot;');
  },
};
