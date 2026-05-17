window.RunsPage = {
  runs: [],
  selectedRunId: null,

  init() {
    document.getElementById('refresh-runs-btn')?.addEventListener('click', () => this.loadRuns());
    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'runs') this.loadRuns();
    });
    window.addEventListener('phantom:trace', (event) => {
      const runId = event.detail?.runId;
      if (runId && (window.Router?.current === 'runs')) this.loadRuns(runId);
    });
  },

  async loadRuns(selectRunId = this.selectedRunId) {
    const list = document.getElementById('runs-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-msg">Loading runs…</div>';
    try {
      const res = await fetch('/api/runs?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.runs = await res.json();
      this.renderRunsList();
      const runToSelect = selectRunId || this.runs[0]?.id;
      if (runToSelect) await this.selectRun(runToSelect);
      else this.renderEmptyDetail();
    } catch (err) {
      list.innerHTML = `<div class="empty-msg danger">Failed to load runs: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderRunsList() {
    const list = document.getElementById('runs-list');
    if (!this.runs.length) {
      list.innerHTML = '<div class="empty-msg">No runs yet. Send a chat message to create one.</div>';
      return;
    }
    list.innerHTML = '';
    this.runs.forEach((run) => {
      const item = document.createElement('button');
      item.className = `run-list-item${run.id === this.selectedRunId ? ' active' : ''}`;
      item.innerHTML = `
        <span class="run-status ${this.escapeHtml(run.status)}"></span>
        <span class="run-list-body">
          <strong>${this.escapeHtml(run.title || run.goal || 'Untitled Run')}</strong>
          <small>${this.escapeHtml(run.model || 'model unknown')} · ${this.escapeHtml(run.started_at || '')}</small>
        </span>
      `;
      item.addEventListener('click', () => this.selectRun(run.id));
      list.appendChild(item);
    });
  },

  async selectRun(id) {
    this.selectedRunId = id;
    this.renderRunsList();
    const detail = document.getElementById('run-detail');
    detail.innerHTML = '<div class="empty-msg">Loading timeline…</div>';
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const run = await res.json();
      detail.innerHTML = `
        <div class="run-detail-header">
          <div>
            <h3>${this.escapeHtml(run.title || 'Run')}</h3>
            <p>${this.escapeHtml(run.goal || '')}</p>
          </div>
          <span class="run-pill ${this.escapeHtml(run.status)}">${this.escapeHtml(run.status)}</span>
        </div>
        <div class="run-meta-grid">
          <div><span>Model</span><strong>${this.escapeHtml(run.model || '—')}</strong></div>
          <div><span>Route</span><strong>${this.escapeHtml(run.provider_route || '—')}</strong></div>
          <div><span>Started</span><strong>${this.escapeHtml(run.started_at || '—')}</strong></div>
          <div><span>Ended</span><strong>${this.escapeHtml(run.ended_at || '—')}</strong></div>
        </div>
        <div class="trace-timeline">
          ${(run.events || []).map(event => this.renderEvent(event)).join('') || '<div class="empty-msg">No events recorded.</div>'}
        </div>
      `;
    } catch (err) {
      detail.innerHTML = `<div class="empty-msg danger">Failed to load run: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderEmptyDetail() {
    document.getElementById('run-detail').innerHTML = '<div class="empty-msg">Select a run to inspect the trace timeline.</div>';
  },

  renderEvent(event) {
    const preview = event.output_preview || event.outputPreview || event.tool_name || '';
    return `
      <div class="trace-event ${this.escapeHtml(event.status || '')}">
        <div class="trace-event-dot"></div>
        <div class="trace-event-body">
          <div class="trace-event-title">
            <span>#${event.seq}</span>
            <strong>${this.escapeHtml(event.type)}</strong>
            ${event.tool_name ? `<em>${this.escapeHtml(event.tool_name)}</em>` : ''}
          </div>
          ${preview ? `<pre>${this.escapeHtml(preview)}</pre>` : ''}
        </div>
      </div>
    `;
  },

  escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  },
};
