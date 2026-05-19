// Approvals page — audit dashboard for every gate decision.
//
// Reads /api/approvals + /api/approvals/stats. Surfaces a KPI strip with
// counts by decision (granted/denied/timeout/override/allow-once), a
// 14-day sparkline, and a filterable list of events. Each event row
// expands to show the args, operator note, and a "Open run" link.
//
// No new tables: events are reconstructed from trace_events by the
// backend, so this view is automatically populated as soon as approval
// flow runs in production.

window.ApprovalsPage = {
  events: [],
  stats: null,
  installRequests: [],
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
        fetch('/api/installer/requests?status=pending&limit=20').then((r) => r.json()).catch(() => []),
      ]);
      this.events = Array.isArray(eventsRes?.events) ? eventsRes.events : [];
      this.stats = statsRes;
      this.installRequests = Array.isArray(installsRes) ? installsRes : [];
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

  // Pending install requests — render as their own card kind, not faked
  // as tool calls. Same persistence as the Settings → Tools installer
  // panel so approve/cancel reflects in both surfaces on next refresh.
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
    host.innerHTML = this.installRequests.map((r) => this.renderInstallCard(r)).join('');
    host.querySelectorAll('[data-install-approve]').forEach((el) => {
      el.addEventListener('click', () => this.approveInstall(el.dataset.installApprove, el));
    });
    host.querySelectorAll('[data-install-cancel]').forEach((el) => {
      el.addEventListener('click', () => this.cancelInstall(el.dataset.installCancel, el));
    });
  },

  renderInstallCard(r) {
    const installable = r.plan.filter((p) => p.backend).length;
    const skipped = r.plan.length - installable;
    const backends = [...new Set(r.plan.filter(p => p.backend).map(p => p.backend))];
    const cmdPreview = r.plan
      .filter(p => p.backend)
      .slice(0, 3)
      .map(p => `${p.command} ${(p.args || []).slice(0, 2).join(' ')}…`)
      .join(' · ');
    return `
      <div class="approval-install-card">
        <div class="approval-install-hd">
          <span class="approval-install-kind">INSTALL · ${this.escapeHtml(backends.join(' / ') || 'no backend')}</span>
          <strong>${r.toolIds.length} tools${skipped ? ` (${installable} resolvable)` : ''}</strong>
          <span class="approval-install-id">${this.escapeHtml(r.id.slice(0, 8))}</span>
          <span class="approval-install-grow"></span>
          <small class="approval-install-when">${this.escapeHtml(this.timeAgo(r.requested_at))}</small>
        </div>
        <div class="approval-install-tools">${this.escapeHtml(r.toolIds.join(', '))}</div>
        ${cmdPreview ? `<div class="approval-install-cmd"><code>${this.escapeHtml(cmdPreview)}</code></div>` : ''}
        <div class="approval-install-actions">
          <button class="btn btn-secondary btn-sm" data-install-cancel="${this.escapeAttribute(r.id)}">Cancel</button>
          <button class="btn btn-primary btn-sm"   data-install-approve="${this.escapeAttribute(r.id)}">Approve &amp; install</button>
        </div>
      </div>
    `;
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
    if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
    try {
      const res = await fetch(`/api/installer/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.load();
    } catch (err) {
      alert(`Cancel failed: ${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = btn.textContent === 'Cancelling…' ? 'Cancel' : btn.textContent; }
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
    const args = e.args
      ? `<pre>${this.escapeHtml(JSON.stringify(e.args, null, 2))}</pre>`
      : '<small class="caption">(no args)</small>';
    const ago = this.timeAgo(e.occurredAt);
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
          <div class="approval-row-args">${args}</div>
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
