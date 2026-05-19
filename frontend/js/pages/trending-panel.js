// Posture trending panel on the Dash. Pulls /api/trending/posture and
// renders three pieces:
//   1. A "current · baseline · delta" headline.
//   2. An inline SVG sparkline of recent run scores (color-coded by rating).
//   3. A timeline list of recent runs using SynthesisCard.renderCompactRow.
//
// Auto-refreshes when the operator hits the Dash route or a run completes.

(function () {
  const TrendingPanel = {
    scopeFilter: '',
    scopesLoaded: false,
    cachedScopes: [],

    init() {
      const refreshBtn = document.getElementById('trending-refresh');
      const filterSel  = document.getElementById('trending-scope-filter');
      if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = '1';
        refreshBtn.addEventListener('click', () => this.load());
      }
      if (filterSel && !filterSel.dataset.bound) {
        filterSel.dataset.bound = '1';
        filterSel.addEventListener('change', () => {
          this.scopeFilter = filterSel.value || '';
          this.load();
        });
      }
      window.addEventListener('phantom:route', (event) => {
        if (event.detail?.route === 'dash') this.load();
      });
      // Refresh whenever a run finishes — the trace fires phantom:trace at
      // each chunk, so we debounce.
      let traceDebounce = null;
      window.addEventListener('phantom:trace', () => {
        if (traceDebounce) clearTimeout(traceDebounce);
        traceDebounce = setTimeout(() => {
          if (window.Router?.current === 'dash') this.load();
        }, 1500);
      });
      // Initial pass after splash → kicks in alongside cockpit data.
      setTimeout(() => this.load(), 200);
    },

    async loadScopes() {
      if (this.scopesLoaded) return;
      const sel = document.getElementById('trending-scope-filter');
      if (!sel) return;
      try {
        const res = await fetch('/api/scopes');
        if (!res.ok) return;
        const scopes = await res.json();
        this.cachedScopes = scopes;
        // Build the option list once. Keep the empty default and append
        // the live scopes; preserve current selection if still valid.
        sel.innerHTML = '<option value="">All scopes</option>' + scopes.map(s =>
          `<option value="${this.escAttr(s.id)}">${this.escHtml(s.name)}</option>`).join('');
        if (this.scopeFilter && scopes.some(s => s.id === this.scopeFilter)) {
          sel.value = this.scopeFilter;
        }
        this.scopesLoaded = true;
      } catch { /* silent */ }
    },

    async load() {
      await this.loadScopes();
      const body = document.getElementById('trending-body');
      const sub  = document.getElementById('trending-sub');
      if (!body) return;
      body.innerHTML = '<div class="empty-msg">Loading trend…</div>';
      try {
        const url = `/api/trending/posture?limit=12${this.scopeFilter ? `&scopeId=${encodeURIComponent(this.scopeFilter)}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.render(data);
        if (sub) {
          sub.textContent = data.runsConsidered
            ? `${data.runsConsidered} RUNS · CURRENT ${data.current ?? '—'} · BASELINE ${data.baseline ?? '—'}`
            : 'NO TERMINAL RUNS YET';
        }
      } catch (err) {
        body.innerHTML = `<div class="empty-msg danger">Failed to load trend: ${this.escHtml(err.message)}</div>`;
      }
    },

    render(data) {
      const body = document.getElementById('trending-body');
      if (!body) return;
      if (!data.sparkline.length) {
        body.innerHTML = `
          <div class="trending-empty">
            <p class="trending-empty-lede">No terminal runs yet.</p>
            <p class="trending-empty-hint">Posture trending will appear once your first run completes.
            The Synthesis tab on the Runs page shows the per-run score the trend aggregates.</p>
          </div>
        `;
        return;
      }

      const head = this.renderHead(data);
      const spark = this.renderSparkline(data.sparkline);
      const byScope = this.renderByScope(data.byScope);
      const recent = this.renderRecent(data.recentRuns);

      body.innerHTML = `
        <div class="trending-grid">
          <div class="trending-col trending-col-head">${head}${spark}</div>
          <div class="trending-col trending-col-scopes">${byScope}</div>
        </div>
        <div class="trending-recent">
          <h4>Recent runs</h4>
          <div class="trending-recent-list" id="trending-recent-list">${recent}</div>
        </div>
      `;
      body.querySelectorAll('[data-run-id]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.runId;
          if (!id || id === 'preview-run') return;
          if (window.RunsPage) window.RunsPage.selectedRunId = id;
          window.Router?.navigate?.('runs');
          window.RunsPage?.loadRuns?.(id);
        });
      });
    },

    renderHead(data) {
      const cur = data.current ?? '—';
      const base = data.baseline ?? '—';
      const delta = data.delta;
      const deltaHtml = delta == null
        ? ''
        : (delta === 0
          ? `<span class="trending-delta zero">±0</span>`
          : `<span class="trending-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}</span>`);
      const ratingClass = ratingFromScore(data.current);
      return `
        <div class="trending-head is-${ratingClass}">
          <div class="trending-head-num">
            <strong>${cur}</strong><span>/100</span>
          </div>
          <div class="trending-head-cap">
            <span class="trending-head-rating">${ratingClass}</span>
            ${deltaHtml}
            <small>baseline ${base}</small>
          </div>
        </div>
      `;
    },

    renderSparkline(series) {
      if (!series.length) return '';
      const w = 320, h = 64, pad = 6;
      const innerW = w - pad * 2;
      const innerH = h - pad * 2;
      const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;
      const yFor = (score) => pad + innerH - (Math.max(0, Math.min(100, score)) / 100) * innerH;
      const points = series.map((d, i) => `${pad + i * stepX},${yFor(d.score)}`).join(' ');
      const dots = series.map((d, i) => {
        const cx = pad + i * stepX;
        const cy = yFor(d.score);
        const cls = `dot is-${d.rating || 'unknown'}`;
        const title = `${d.title} · ${d.score} · ${d.endedAt || ''}`;
        return `<circle class="${cls}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" data-run-id="${this.escAttr(d.runId)}">
          <title>${this.escHtml(title)}</title>
        </circle>`;
      }).join('');
      // Baseline guide at 50.
      const baseY = yFor(50);
      return `
        <svg class="trending-spark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}"
             role="img" aria-label="Posture trend over the last ${series.length} runs">
          <line class="trending-spark-baseline" x1="${pad}" y1="${baseY}" x2="${w - pad}" y2="${baseY}"/>
          <polyline class="trending-spark-line" points="${points}"/>
          ${dots}
        </svg>
      `;
    },

    renderByScope(byScope) {
      if (!byScope.length) return '';
      const rows = byScope.map(s => {
        const rating = ratingFromScore(s.current);
        const deltaHtml = s.delta == null
          ? ''
          : (s.delta === 0
            ? '<span class="trending-delta zero">±0</span>'
            : `<span class="trending-delta ${s.delta > 0 ? 'up' : 'down'}">${s.delta > 0 ? '▲' : '▼'} ${Math.abs(s.delta)}</span>`);
        return `<li class="trending-scope-row is-${rating}">
          <span class="trending-scope-name">${this.escHtml(s.name)}</span>
          <span class="trending-scope-score">${s.current ?? '—'}</span>
          ${deltaHtml}
          <small class="trending-scope-runs">${s.runs} run${s.runs === 1 ? '' : 's'}</small>
        </li>`;
      }).join('');
      return `
        <h4>By scope</h4>
        <ul class="trending-scope-list">${rows}</ul>
      `;
    },

    renderRecent(synth) {
      if (!synth.length || !window.SynthesisCard) return '<div class="empty-msg">No recent runs.</div>';
      return synth.map(s => window.SynthesisCard.renderCompactRow(s)).join('');
    },

    escHtml(value) {
      const d = document.createElement('div');
      d.textContent = value == null ? '' : String(value);
      return d.innerHTML;
    },
    escAttr(value) {
      return this.escHtml(value).replace(/"/g, '&quot;');
    },
  };

  function ratingFromScore(score) {
    if (score == null || !Number.isFinite(Number(score))) return 'unknown';
    if (score >= 75) return 'strong';
    if (score >= 50) return 'fair';
    return 'weak';
  }

  window.TrendingPanel = TrendingPanel;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TrendingPanel.init());
  } else {
    TrendingPanel.init();
  }
})();
