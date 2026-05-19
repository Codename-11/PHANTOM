/* PHANTOM SEC — Alert Queue page module
 * Triage table + drawer over GET /api/findings.
 * Exposes window.AlertsPage = { init, show, hide, loadFindings }.
 */
(function () {
  'use strict';

  const SEV_RANK = { critical: 5, crit: 5, high: 4, medium: 3, med: 3, low: 2, info: 1, ok: 0 };
  const SEV_CLASS = { critical: 'crit', crit: 'crit', high: 'high', medium: 'med', med: 'med', low: 'low', info: 'info', ok: 'ok' };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function sevClass(sev) {
    return SEV_CLASS[String(sev || '').toLowerCase()] || 'info';
  }

  function timeAgo(ts) {
    if (!ts) return '—';
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return '—';
    const diff = Math.max(0, Date.now() - t);
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  function fmtTs(ts) {
    if (!ts) return '—';
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return String(ts);
    const dt = new Date(t);
    return dt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  function parseMeta(finding) {
    let meta = finding.metadata;
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch (_) { meta = {}; }
    }
    return meta && typeof meta === 'object' ? meta : {};
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
    };
  }

  const AlertsPage = {
    findings: [],
    filtered: [],
    selectedId: null,
    selectedIndex: -1,
    activeTab: 'evidence',
    searchTerm: '',
    filters: { sev: 'high+', status: 'open' },
    view: 'queue',
    assetCache: new Map(),
    _initialized: false,
    _booted: false,

    init() {
      if (this._initialized) return;
      this._initialized = true;

      // Search
      const search = $('alerts-search-input');
      if (search) {
        search.addEventListener('input', debounce(() => {
          this.searchTerm = search.value.trim().toLowerCase();
          this.applyFiltersAndRender();
        }, 150));
      }

      // Filter chips (click toggles active state, then re-applies)
      const chipsBar = $('alerts-filter-chips');
      if (chipsBar) {
        chipsBar.addEventListener('click', (event) => {
          const chip = event.target.closest('.filter-chip');
          if (!chip) return;
          chip.classList.toggle('active');
          const key = chip.dataset.filter;
          if (key) {
            // empty value removes filter
            const isActive = chip.classList.contains('active');
            this.filters[key] = isActive ? chip.dataset.value : null;
          }
          this.loadFindings();
        });
      }

      // View seg-group
      const segs = document.querySelectorAll('#alerts-page .seg-group .seg');
      segs.forEach((seg) => {
        seg.addEventListener('click', () => {
          segs.forEach(s => s.classList.remove('pressed'));
          seg.classList.add('pressed');
          this.view = seg.dataset.view;
          this.renderQueue();
        });
      });

      // Drawer tabs
      const tabsBar = $('alerts-drawer-tabs');
      if (tabsBar) {
        tabsBar.addEventListener('click', (event) => {
          const tab = event.target.closest('.drawer-tab');
          if (!tab) return;
          this.activeTab = tab.dataset.tab;
          tabsBar.querySelectorAll('.drawer-tab').forEach(t => t.classList.toggle('active', t === tab));
          this.renderDrawerBody();
        });
      }

      // Drawer footer buttons
      $('alerts-ack-btn')?.addEventListener('click', () => this.acknowledgeSelected());
      $('alerts-openrun-btn')?.addEventListener('click', () => this.openRunForSelected());
      $('alerts-report-btn')?.addEventListener('click', () => {
        // placeholder — out of scope this pass
      });

      // Keyboard navigation
      document.addEventListener('keydown', (event) => {
        if (window.Router?.current !== 'alerts') return;
        const tag = (event.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); this.moveSelection(1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); this.moveSelection(-1); }
        else if (event.key === 'e' || event.key === 'E') { event.preventDefault(); if (this.selectedId) this.openDrawer(this.selectedId); }
        else if (event.key === 'x' || event.key === 'X') { event.preventDefault(); this.acknowledgeSelected().then(() => this.closeDrawer()); }
      });

      // React to route changes
      window.addEventListener('phantom:route', (event) => {
        if (event.detail?.route === 'alerts') this.show();
        else if (this._booted) this.hide();
      });

      // Export button (stub: download JSON of current filtered list)
      $('alerts-export-btn')?.addEventListener('click', () => this.exportFiltered());

      // If we're already on the alerts route on first init (deep-link refresh)
      if (window.Router?.current === 'alerts') setTimeout(() => this.show(), 0);
    },

    show() {
      this._booted = true;
      this.loadFindings();
    },

    hide() {
      // Don't permanently close — just leave state; drawer stays in-DOM but visually hidden.
    },

    async loadFindings() {
      const tbody = $('alerts-tbody');
      const counts = $('alerts-counts');
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="alerts-empty">Loading findings…</td></tr>`;
      try {
        const params = new URLSearchParams();
        params.set('limit', '200');
        if (this.filters.status === 'open') params.set('status', 'open');
        // severity filter sent server-side too (low-effort dedup is fine)
        const res = await fetch(`/api/findings?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        this.findings = Array.isArray(rows) ? rows : [];
        this.applyFiltersAndRender();
      } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="alerts-empty danger">Failed to load findings: ${escapeHtml(err.message)}</td></tr>`;
        if (counts) counts.textContent = '— findings';
      }
    },

    applyFiltersAndRender() {
      const term = this.searchTerm;
      const sevFilter = this.filters.sev;
      const statusFilter = this.filters.status;
      const minSev = sevFilter === 'high+' ? SEV_RANK.high
        : sevFilter === 'critical' ? SEV_RANK.critical
        : sevFilter === 'medium+' ? SEV_RANK.medium
        : 0;
      this.filtered = (this.findings || []).filter((f) => {
        const rank = SEV_RANK[String(f.severity || '').toLowerCase()] || 0;
        if (rank < minSev) return false;
        if (statusFilter && f.status !== statusFilter) return false;
        if (term) {
          const meta = parseMeta(f);
          const hay = [
            f.id, f.title, f.description, f.assetId, f.runId,
            meta.rule, meta.cve, meta.cwe, meta.target, meta.host, meta.detector,
          ].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(term)) return false;
        }
        return true;
      }).sort((a, b) => {
        const ra = SEV_RANK[String(a.severity || '').toLowerCase()] || 0;
        const rb = SEV_RANK[String(b.severity || '').toLowerCase()] || 0;
        if (rb !== ra) return rb - ra;
        const ta = Date.parse(a.first_seen_at || a.last_seen_at || 0) || 0;
        const tb = Date.parse(b.first_seen_at || b.last_seen_at || 0) || 0;
        return tb - ta;
      });
      this.renderQueue();
    },

    renderQueue() {
      const tbody = $('alerts-tbody');
      const counts = $('alerts-counts');
      if (!tbody) return;

      if (this.view !== 'queue') {
        tbody.innerHTML = `<tr><td colspan="10" class="alerts-empty">${escapeHtml(this.view === 'grid' ? 'Grid view' : 'Map view')} coming soon. Switch to Queue to triage.</td></tr>`;
        if (counts) counts.textContent = `${this.filtered.length} findings`;
        return;
      }

      if (!this.filtered.length) {
        tbody.innerHTML = `<tr><td colspan="10" class="alerts-empty">No findings match the current filters.</td></tr>`;
        if (counts) counts.textContent = '0 findings';
        // close drawer if open
        this.closeDrawer();
        return;
      }

      const rowsHtml = this.filtered.map((f) => this.renderRow(f)).join('');
      tbody.innerHTML = rowsHtml;

      // wire row clicks
      tbody.querySelectorAll('tr[data-finding-id]').forEach((tr) => {
        tr.addEventListener('click', () => this.openDrawer(tr.dataset.findingId));
      });

      // counts
      const critUntriaged = this.filtered.filter(f => sevClass(f.severity) === 'crit' && f.status === 'open').length;
      if (counts) counts.textContent = `${this.filtered.length} findings · ${critUntriaged} critical untriaged`;

      // keep selection consistent
      if (this.selectedId) {
        const idx = this.filtered.findIndex(f => f.id === this.selectedId);
        if (idx >= 0) {
          this.selectedIndex = idx;
          this.highlightSelected();
        } else {
          this.selectedId = null;
          this.selectedIndex = -1;
          this.closeDrawer();
        }
      }
    },

    renderRow(f) {
      const sev = sevClass(f.severity);
      const meta = parseMeta(f);
      const idShort = String(f.id || '').slice(0, 8);
      const title = f.title || '(untitled)';
      const asset = meta.asset_name || meta.assetName || (f.assetId ? String(f.assetId).slice(0, 8) : '—');
      const rule = meta.rule || meta.detector || '—';
      const target = meta.target || meta.host || (meta.port ? `${meta.host || ''}:${meta.port}` : '—');
      const age = timeAgo(f.first_seen_at || f.last_seen_at);
      const status = f.status || 'open';
      const selected = this.selectedId === f.id ? ' selected' : '';
      return `
        <tr class="${sev}${selected}" data-finding-id="${escapeAttr(f.id)}">
          <td class="sev-col"></td>
          <td class="id-col mono" title="${escapeAttr(f.id)}">${escapeHtml(idShort)}</td>
          <td><span class="sev-badge ${sev}">${escapeHtml(sev.toUpperCase())}</span></td>
          <td class="title-col">${escapeHtml(title)}</td>
          <td class="asset-col mono">${escapeHtml(asset)}</td>
          <td class="rule-col mono">${escapeHtml(rule)}</td>
          <td class="host-col mono">${escapeHtml(target)}</td>
          <td class="status-col"><span class="status-pill ${escapeAttr(status)}">${escapeHtml(status)}</span></td>
          <td class="age-col mono">${escapeHtml(age)}</td>
          <td class="menu-col"><button class="row-menu" aria-label="More" tabindex="-1" data-noop>⋯</button></td>
        </tr>
      `;
    },

    highlightSelected() {
      const tbody = $('alerts-tbody');
      if (!tbody) return;
      tbody.querySelectorAll('tr').forEach((tr) => {
        tr.classList.toggle('selected', tr.dataset.findingId === this.selectedId);
      });
    },

    moveSelection(delta) {
      if (!this.filtered.length) return;
      const next = Math.max(0, Math.min(this.filtered.length - 1, (this.selectedIndex < 0 ? 0 : this.selectedIndex + delta)));
      const f = this.filtered[next];
      if (!f) return;
      this.openDrawer(f.id);
    },

    openDrawer(id) {
      const f = this.filtered.find(x => x.id === id) || this.findings.find(x => x.id === id);
      if (!f) return;
      this.selectedId = id;
      this.selectedIndex = this.filtered.findIndex(x => x.id === id);
      this.highlightSelected();

      const drawer = $('alerts-drawer');
      if (drawer) drawer.classList.remove('hidden');

      this.renderDrawerHeader(f);
      this.renderDrawerBody();
    },

    closeDrawer() {
      const drawer = $('alerts-drawer');
      if (drawer) drawer.classList.add('hidden');
    },

    renderDrawerHeader(f) {
      const hd = $('alerts-drawer-hd');
      if (!hd) return;
      const sev = sevClass(f.severity);
      const meta = parseMeta(f);
      const subBits = [];
      if (meta.cwe) subBits.push(meta.cwe);
      if (meta.cve) subBits.push(meta.cve);
      subBits.push(meta.detector || meta.rule || 'manual');
      subBits.push(`${timeAgo(f.first_seen_at || f.last_seen_at)} ago`);
      hd.innerHTML = `
        <button class="drawer-close-btn" id="alerts-drawer-close" aria-label="Close alert detail">×</button>
        <div class="head-line">
          <span class="sev-tick ${sev}"></span>
          <span class="sev-badge ${sev}">${escapeHtml(sev.toUpperCase())}</span>
          <span class="mono">${escapeHtml(String(f.id).slice(0, 12))}</span>
          <span class="status-pill ${escapeAttr(f.status || 'open')}">${escapeHtml(f.status || 'open')}</span>
        </div>
        <h2>${escapeHtml(f.title || '(untitled)')}</h2>
        <div class="drawer-sub mono">${escapeHtml(subBits.join(' · '))}</div>
      `;
      const closeBtn = document.getElementById('alerts-drawer-close');
      if (closeBtn) closeBtn.addEventListener('click', () => this.closeDrawer());
    },

    renderDrawerBody() {
      const bd = $('alerts-drawer-bd');
      if (!bd) return;
      const f = this.findings.find(x => x.id === this.selectedId) || this.filtered.find(x => x.id === this.selectedId);
      if (!f) { bd.innerHTML = ''; return; }
      switch (this.activeTab) {
        case 'asset':   bd.innerHTML = this.renderAssetTab(f); this.lazyLoadAsset(f); break;
        case 'trace':   bd.innerHTML = this.renderTraceTab(f); this.wireTraceActions(f); break;
        case 'history': bd.innerHTML = this.renderHistoryTab(f); break;
        case 'evidence':
        default:        bd.innerHTML = this.renderEvidenceTab(f);
      }
    },

    renderEvidenceTab(f) {
      const meta = parseMeta(f);
      const kv = [
        { k: 'asset',       v: meta.asset_name || meta.assetName || (f.assetId ? `<span class="mono">${escapeHtml(f.assetId)}</span>` : '—') },
        { k: 'host:port',   v: meta.target || meta.host || '—' },
        { k: 'cwe / cve',   v: [meta.cwe, meta.cve].filter(Boolean).join(' · ') || '—' },
        { k: 'detector',    v: meta.detector || meta.rule || 'manual' },
        { k: 'run',         v: f.runId ? `<a class="link" data-run-link="${escapeAttr(f.runId)}">${escapeHtml(String(f.runId).slice(0, 12))}</a>` : '—' },
        { k: 'first seen',  v: fmtTs(f.first_seen_at) },
        { k: 'last seen',   v: fmtTs(f.last_seen_at) },
        { k: 'fingerprint', v: `<span class="mono">${escapeHtml(f.id)}</span>` },
      ];
      const kvHtml = kv.map(it => `<dt>${escapeHtml(it.k)}</dt><dd>${it.v}</dd>`).join('');

      const proofRaw = f.evidence;
      let proofHtml = '';
      if (proofRaw) {
        const text = typeof proofRaw === 'string' ? proofRaw : JSON.stringify(proofRaw, null, 2);
        proofHtml = `<div class="drawer-section-label">PROOF-OF-CONCEPT</div><pre class="poc-block">${escapeHtml(text)}</pre>`;
      }

      const policy = meta.policy || meta.policyDecision;
      let policyHtml = '';
      if (policy && typeof policy === 'object') {
        const blocked = policy.blocked || policy.decision === 'deny' || policy.outcome === 'blocked';
        policyHtml = `
          <div class="drawer-section-label">POLICY DECISION</div>
          <section class="policy-decision">
            <strong>${escapeHtml(blocked ? 'Exploit step blocked' : (policy.title || 'Allowed by policy'))}</strong>
            <div class="mono" style="margin-top:4px;">${escapeHtml(policy.reason || policy.note || (blocked ? 'Modifying action was held by scope policy.' : 'Allowed under current scope policy.'))}</div>
          </section>`;
      }

      let fixHtml = '';
      if (f.recommendation) {
        const items = String(f.recommendation).split(/\n+/).map(s => s.trim()).filter(Boolean);
        if (items.length) {
          fixHtml = `<div class="drawer-section-label">SUGGESTED FIX</div><ul class="fix-list">${items.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
        }
      }

      let descHtml = '';
      if (f.description) {
        descHtml = `<div class="drawer-section-label">DESCRIPTION</div><p class="drawer-desc">${escapeHtml(f.description)}</p>`;
      }

      const body = `
        <div class="drawer-section-label">EVIDENCE</div>
        <dl>${kvHtml}</dl>
        ${descHtml}
        ${proofHtml}
        ${policyHtml}
        ${fixHtml}
      `;
      // wire run-link after insert
      setTimeout(() => {
        const link = document.querySelector('#alerts-drawer-bd [data-run-link]');
        link?.addEventListener('click', (event) => {
          event.preventDefault();
          this.openRunForSelected();
        });
      }, 0);
      return body;
    },

    renderAssetTab(f) {
      if (!f.assetId) return `<div class="alerts-empty">No asset linked to this finding.</div>`;
      const cached = this.assetCache.get(f.assetId);
      if (cached) return this.renderAssetCard(cached);
      return `<div class="alerts-empty">Loading asset…</div>`;
    },

    renderAssetCard(asset) {
      const kv = [
        { k: 'name',         v: asset.name || asset.identifier || '—' },
        { k: 'type',         v: asset.type || '—' },
        { k: 'address',      v: asset.address || asset.target || '—' },
        { k: 'criticality',  v: asset.criticality || '—' },
        { k: 'environment',  v: asset.environment || '—' },
        { k: 'scope',        v: asset.scope_id || asset.scopeId || '—' },
      ];
      return `<dl>${kv.map(it => `<dt>${escapeHtml(it.k)}</dt><dd>${escapeHtml(it.v)}</dd>`).join('')}</dl>`;
    },

    async lazyLoadAsset(f) {
      if (!f.assetId || this.assetCache.has(f.assetId)) return;
      try {
        const res = await fetch(`/api/assets/${encodeURIComponent(f.assetId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const asset = await res.json();
        this.assetCache.set(f.assetId, asset);
        if (this.activeTab === 'asset' && this.selectedId === f.id) {
          const bd = $('alerts-drawer-bd');
          if (bd) bd.innerHTML = this.renderAssetCard(asset);
        }
      } catch (_err) {
        if (this.activeTab === 'asset' && this.selectedId === f.id) {
          const bd = $('alerts-drawer-bd');
          if (bd) bd.innerHTML = `<div class="alerts-empty danger">Failed to load asset.</div>`;
        }
      }
    },

    renderTraceTab(f) {
      if (!f.runId) return `<div class="alerts-empty">No trace linked to this finding.</div>`;
      return `
        <div class="drawer-section-label">TRACE</div>
        <p class="drawer-desc">This finding was raised during run <span class="mono">${escapeHtml(String(f.runId).slice(0, 12))}</span>.</p>
        <button class="btn primary sm" data-action="open-run">Open run</button>
      `;
    },

    wireTraceActions(f) {
      const bd = $('alerts-drawer-bd');
      bd?.querySelector('[data-action="open-run"]')?.addEventListener('click', () => this.openRunForSelected());
    },

    renderHistoryTab(f) {
      const meta = parseMeta(f);
      const history = Array.isArray(meta.history) ? meta.history : null;
      const baseEvents = [
        { ts: f.first_seen_at, label: 'First seen' },
        { ts: f.last_seen_at,  label: 'Last seen' },
      ];
      if (f.fixed_at) baseEvents.push({ ts: f.fixed_at, label: 'Marked fixed' });
      const events = (history || []).concat(baseEvents).filter(e => e.ts);
      if (!events.length) return `<div class="alerts-empty">No history events recorded.</div>`;
      events.sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
      return `
        <div class="drawer-section-label">HISTORY</div>
        <ul class="fix-list">
          ${events.map(e => `<li><span class="mono">${escapeHtml(fmtTs(e.ts))}</span> — ${escapeHtml(e.label || e.type || 'event')}</li>`).join('')}
        </ul>
      `;
    },

    async acknowledgeSelected() {
      if (!this.selectedId) return;
      const id = this.selectedId;
      try {
        const res = await fetch(`/api/findings/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'acknowledged' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = await res.json();
        // update local copy
        const idx = this.findings.findIndex(f => f.id === id);
        if (idx >= 0) this.findings[idx] = { ...this.findings[idx], ...updated };
        // Trigger the once-only verified beat in the drawer header
        // before the queue refresh re-renders the drawer.
        const hd = document.getElementById('alerts-drawer-hd');
        if (hd && window.StateIcons) {
          const slot = document.createElement('span');
          slot.className = 'drawer-verified-anim';
          slot.innerHTML = window.StateIcons.verified(40);
          hd.appendChild(slot);
          const svg = slot.querySelector('svg');
          if (svg) window.StateIcons.play(svg);
        }
        setTimeout(() => {
          this.applyFiltersAndRender();
          window.dispatchEvent(new CustomEvent('phantom:findings-changed'));
        }, 800);
      } catch (_err) {
        // surface inline if needed; left silent for now
      }
    },

    openRunForSelected() {
      const f = this.findings.find(x => x.id === this.selectedId);
      if (!f?.runId) return;
      if (window.RunsPage) window.RunsPage.selectedRunId = f.runId;
      window.Router?.navigate?.('runs');
      window.RunsPage?.loadRuns?.(f.runId);
    },

    exportFiltered() {
      const blob = new Blob([JSON.stringify(this.filtered, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `phantom-alerts-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  };

  window.AlertsPage = AlertsPage;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AlertsPage.init());
  } else {
    AlertsPage.init();
  }
})();
