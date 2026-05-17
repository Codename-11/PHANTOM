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
          <div><span>Scope</span><strong>${this.escapeHtml(run.scope?.name || 'No scope')}</strong></div>
          <div><span>Prompt profile</span><strong>${this.escapeHtml(run.prompt_snapshot?.profile?.name || 'Default')}</strong></div>
          <div><span>Started</span><strong>${this.escapeHtml(run.started_at || '—')}</strong></div>
          <div><span>Ended</span><strong>${this.escapeHtml(run.ended_at || '—')}</strong></div>
        </div>
        <div class="run-actions">
          <button class="btn btn-secondary btn-sm" data-run-action="report">Generate pentest report</button>
          <button class="btn btn-secondary btn-sm" data-run-action="summary">Generate executive summary</button>
          <button class="btn btn-secondary btn-sm" data-run-action="evidence">Export evidence bundle</button>
          <button class="btn btn-secondary btn-sm" data-run-action="local-preview" ${this.hasHtmlArtifact(run) ? '' : 'disabled'}>Local preview</button>
          <button class="btn btn-secondary btn-sm" data-run-action="graph">Open graph</button>
          <button class="btn btn-secondary btn-sm" disabled title="Publishing is intentionally later-phase work">Publish preview</button>
        </div>
        <div class="run-artifacts-block">
          <div class="section-subhead"><h4>Artifacts</h4><button class="inline-link" data-route="artifacts">Open Artifacts page</button></div>
          ${this.renderRunArtifacts(run.artifacts || [])}
        </div>
        <div class="trace-timeline">
          ${(run.events || []).map(event => this.renderEvent(event)).join('') || '<div class="empty-msg">No events recorded.</div>'}
        </div>
      `;
      detail.querySelectorAll('[data-run-action]').forEach((button) => {
        button.addEventListener('click', () => this.handleRunAction(run, button.dataset.runAction, button));
      });
      detail.querySelector('[data-route="artifacts"]')?.addEventListener('click', () => window.Router?.navigate?.('artifacts'));
    } catch (err) {
      detail.innerHTML = `<div class="empty-msg danger">Failed to load run: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderEmptyDetail() {
    document.getElementById('run-detail').innerHTML = '<div class="empty-msg">Select a run to inspect the trace timeline.</div>';
  },

  renderEvent(event) {
    const preview = event.output_preview || event.outputPreview || event.tool_name || '';
    const isBlocked = event.type === 'tool.call.blocked' || event.type === 'scope.blocked';
    return `
      <div class="trace-event ${this.escapeHtml(isBlocked ? 'failed' : (event.status || ''))}">
        <div class="trace-event-dot"></div>
        <div class="trace-event-body">
          <div class="trace-event-title">
            <span>#${event.seq}</span>
            <strong>${isBlocked ? '🛡️ ' : ''}${this.escapeHtml(event.type)}</strong>
            ${event.tool_name ? `<em>${this.escapeHtml(event.tool_name)}</em>` : ''}
          </div>
          ${preview ? `<pre>${this.escapeHtml(preview)}</pre>` : ''}
        </div>
      </div>
    `;
  },

  renderRunArtifacts(artifacts) {
    if (!artifacts.length) return '<div class="empty-msg">No artifacts captured for this run yet.</div>';
    return `<div class="run-artifact-chips">
      ${artifacts.map(artifact => `
        <a class="artifact-chip" href="${this.escapeAttribute(artifact.contentUrl)}" target="_blank" rel="noopener">
          <span>${this.escapeHtml(artifact.type || 'artifact')}</span>
          <strong>${this.escapeHtml(artifact.title || artifact.id)}</strong>
        </a>
      `).join('')}
    </div>`;
  },

  hasHtmlArtifact(run) {
    return (run.artifacts || []).some(artifact => artifact.type === 'html' && artifact.contentUrl);
  },

  async handleRunAction(run, action, button) {
    if (action === 'graph') {
      if (window.GraphPage) window.GraphPage.selectedRunId = run.id;
      window.Router?.navigate?.('graph');
      window.GraphPage?.loadGraph?.(run.id);
      return;
    }

    if (action === 'local-preview') {
      const artifact = (run.artifacts || []).find(item => item.type === 'html' && item.contentUrl);
      if (artifact) window.showPreview?.('', artifact.title || 'Preview', artifact);
      return;
    }

    const endpoints = {
      report: 'report',
      summary: 'summary',
      evidence: 'evidence',
    };
    const endpoint = endpoints[action];
    if (!endpoint) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/artifacts/${endpoint}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const artifact = await res.json();
      window.dispatchEvent(new CustomEvent('phantom:artifact', { detail: { artifact, runId: run.id, conversationId: run.conversation_id } }));
      await this.selectRun(run.id);
      window.ArtifactsPage?.loadArtifacts?.(artifact.id);
    } catch (err) {
      button.textContent = `Failed: ${err.message}`;
      setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 1800);
      return;
    }
    button.textContent = original;
    button.disabled = false;
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
