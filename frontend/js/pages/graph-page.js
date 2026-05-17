window.GraphPage = {
  runs: [],
  selectedRunId: null,
  graph: null,
  layout: null,
  selectedNodeId: null,
  refreshTimer: null,
  followLive: true,
  liveRunId: null,
  transform: { x: 0, y: 0, scale: 1 },
  shouldFitNext: true,
  isPanning: false,
  panStart: null,

  init() {
    document.getElementById('refresh-graph-btn')?.addEventListener('click', () => this.loadRuns(this.selectedRunId));
    document.getElementById('export-graph-btn')?.addEventListener('click', () => this.exportGraph());
    document.getElementById('graph-fit-btn')?.addEventListener('click', () => this.fitToView());
    document.getElementById('graph-reset-btn')?.addEventListener('click', () => this.resetView());
    document.getElementById('graph-zoom-in-btn')?.addEventListener('click', () => this.zoomBy(1.18));
    document.getElementById('graph-zoom-out-btn')?.addEventListener('click', () => this.zoomBy(0.84));
    document.getElementById('graph-follow-btn')?.addEventListener('click', () => this.toggleFollowLive());
    window.addEventListener('resize', () => {
      if (window.Router?.current === 'graph' && this.graph) this.fitToView({ preserveSelection: true });
    });
    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'graph') this.loadRuns(this.followLive && this.liveRunId ? this.liveRunId : this.selectedRunId);
    });
    window.addEventListener('phantom:trace', (event) => this.handleLiveEvent(event.detail || {}));
    window.addEventListener('phantom:artifact', (event) => this.handleLiveEvent(event.detail || {}, { artifact: true }));
    this.updateFollowButton();
    this.updateLiveIndicator();
    if (window.Router?.current === 'graph') setTimeout(() => this.loadRuns(this.selectedRunId), 0);
  },

  handleLiveEvent(detail, { artifact = false } = {}) {
    const runId = detail?.runId;
    if (!runId) return;
    this.liveRunId = runId;
    this.updateLiveIndicator();
    if (this.followLive && (!this.selectedRunId || this.selectedRunId !== runId)) {
      this.selectedRunId = runId;
      this.selectedNodeId = null;
      this.shouldFitNext = true;
      if (window.Router?.current === 'graph') this.scheduleRunsRefresh(runId);
    } else if (window.Router?.current === 'graph' && this.selectedRunId === runId) {
      this.scheduleGraphRefresh(runId, { keepView: !artifact });
    }
  },

  scheduleRunsRefresh(runId) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.loadRuns(runId), 250);
  },

  scheduleGraphRefresh(runId, { keepView = true } = {}) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.loadGraph(runId, { fit: !keepView && this.followLive }), 250);
  },

  toggleFollowLive() {
    this.followLive = !this.followLive;
    if (this.followLive && this.liveRunId) {
      this.selectedRunId = this.liveRunId;
      this.selectedNodeId = null;
      this.shouldFitNext = true;
      if (window.Router?.current === 'graph') this.loadRuns(this.liveRunId);
    }
    this.updateFollowButton();
    this.updateLiveIndicator();
  },

  updateFollowButton() {
    const button = document.getElementById('graph-follow-btn');
    if (!button) return;
    button.setAttribute('aria-pressed', String(this.followLive));
    button.textContent = this.followLive ? '⏱ Following live' : '⏸ Follow paused';
    button.classList.toggle('active', this.followLive);
  },

  updateLiveIndicator() {
    const indicator = document.getElementById('graph-live-indicator');
    if (!indicator) return;
    const current = this.runs.find(run => run.id === this.selectedRunId);
    const isLive = current && !['completed', 'failed', 'stopped'].includes(current.status);
    indicator.className = `graph-live-indicator ${isLive ? 'live' : this.followLive ? 'watching' : 'idle'}`;
    if (isLive && this.followLive) indicator.textContent = '● Live · following';
    else if (isLive) indicator.textContent = '● Live · paused';
    else if (this.followLive) indicator.textContent = this.liveRunId ? 'Watching next event' : 'Watching live';
    else indicator.textContent = 'Historical';
  },

  async loadRuns(selectRunId = this.selectedRunId) {
    const list = document.getElementById('graph-runs-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-msg">Loading runs…</div>';
    try {
      const res = await fetch('/api/runs?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.runs = await res.json();
      this.renderRunsList();
      const runToSelect = selectRunId || this.selectedRunId || this.runs[0]?.id;
      if (runToSelect) await this.loadGraph(runToSelect, { fit: this.shouldFitNext });
      else this.renderEmptyGraph();
      this.updateLiveIndicator();
    } catch (err) {
      list.innerHTML = `<div class="empty-msg danger">Failed to load runs: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderRunsList() {
    const list = document.getElementById('graph-runs-list');
    if (!list) return;
    if (!this.runs.length) {
      list.innerHTML = '<div class="empty-msg">No runs yet. Send a chat message to create one.</div>';
      return;
    }
    list.innerHTML = '';
    this.runs.forEach((run) => {
      const isTerminal = ['completed', 'failed', 'stopped'].includes(run.status);
      const item = document.createElement('button');
      item.className = `run-list-item${run.id === this.selectedRunId ? ' active' : ''}${!isTerminal ? ' live-run' : ''}`;
      item.dataset.runId = run.id;
      item.innerHTML = `
        <span class="run-status ${this.escapeHtml(run.status)}"></span>
        <span class="run-list-body">
          <strong>${this.escapeHtml(run.title || run.goal || 'Untitled Run')}</strong>
          <small>${this.escapeHtml(run.model || 'model unknown')} · ${this.escapeHtml(run.scope?.name || 'no scope')} · ${this.escapeHtml(run.started_at || '')}</small>
        </span>
        ${!isTerminal ? '<span class="run-live-pill">Live</span>' : ''}
      `;
      item.addEventListener('click', () => {
        this.followLive = false;
        this.selectedNodeId = null;
        this.shouldFitNext = true;
        this.updateFollowButton();
        this.loadGraph(run.id, { fit: true });
      });
      list.appendChild(item);
    });
  },

  async loadGraph(runId, { fit = false } = {}) {
    if (!runId) return;
    this.selectedRunId = runId;
    this.renderRunsList();
    const canvas = document.getElementById('graph-canvas');
    if (canvas && !this.graph) canvas.innerHTML = '<div class="empty-msg">Deriving graph from trace events…</div>';
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/graph`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.graph = await res.json();
      if (!this.selectedNodeId || !this.graph.nodes.some(node => node.id === this.selectedNodeId)) {
        this.selectedNodeId = this.graph.nodes[0]?.id || null;
      }
      this.layout = window.GraphLayout.layoutGraph(this.graph);
      if (fit || this.shouldFitNext) {
        this.fitToView({ render: false });
        this.shouldFitNext = false;
      }
      this.renderGraph();
      this.renderNodeDetail();
      this.updateLiveIndicator();
    } catch (err) {
      if (canvas) canvas.innerHTML = `<div class="empty-msg danger">Failed to load graph: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderEmptyGraph() {
    const canvas = document.getElementById('graph-canvas');
    if (canvas) canvas.innerHTML = '<div class="empty-msg">Select a run to render its execution graph.</div>';
    const detail = document.getElementById('graph-node-detail');
    if (detail) detail.innerHTML = '<div class="empty-msg">No node selected.</div>';
    const stats = document.getElementById('graph-stats');
    if (stats) stats.textContent = 'No graph loaded';
  },

  renderGraph() {
    const canvas = document.getElementById('graph-canvas');
    const stats = document.getElementById('graph-stats');
    if (!canvas || !this.graph || !this.layout) return;
    const layout = this.layout;
    const nodeMap = new Map(layout.nodes.map(node => [node.id, node]));
    const selectedEdges = new Set((this.graph.edges || [])
      .filter(edge => edge.source === this.selectedNodeId || edge.target === this.selectedNodeId)
      .flatMap(edge => [edge.id || `${edge.type}:${edge.source}->${edge.target}`, edge.source, edge.target]));

    if (stats) {
      const blocked = this.graph.nodes.filter(node => node.status === 'blocked').length;
      const liveText = this.followLive ? ' · follow on' : ' · follow paused';
      stats.textContent = `${this.graph.stats?.nodes || this.graph.nodes.length} nodes · ${this.graph.stats?.edges || this.graph.edges.length} edges · ${this.graph.stats?.events || 0} events · ${this.graph.stats?.artifacts || 0} artifacts${blocked ? ` · ${blocked} blocked` : ''}${liveText}`;
    }

    const edgeMarkup = layout.edges.map((edge) => {
      if (!edge.path) return '';
      const id = edge.id || `${edge.type}:${edge.source}->${edge.target}`;
      const related = !this.selectedNodeId || edge.source === this.selectedNodeId || edge.target === this.selectedNodeId;
      return `<path class="graph-edge ${this.escapeAttribute(edge.type)} ${edge.type === 'blocked_by_policy' ? 'blocked' : ''} ${related ? 'related' : 'dimmed'}" d="${this.escapeAttribute(edge.path)}" marker-end="url(#graph-arrow)"><title>${this.escapeHtml(edge.type || 'edge')}</title></path>`;
    }).join('');

    const nodeMarkup = layout.nodes.map((node) => {
      const related = !this.selectedNodeId || node.id === this.selectedNodeId || selectedEdges.has(node.id);
      return `
      <g class="graph-node ${this.escapeAttribute(node.type)} ${this.escapeAttribute(node.status || '')} ${node.id === this.selectedNodeId ? 'selected' : ''} ${related ? 'related' : 'dimmed'}" data-node-id="${this.escapeAttribute(node.id)}" transform="translate(${node.x}, ${node.y})" tabindex="0" role="button">
        <rect rx="12" width="${layout.nodeWidth}" height="${layout.nodeHeight}"></rect>
        <circle cx="18" cy="29" r="7"></circle>
        <text x="34" y="24" class="graph-node-type">${this.escapeHtml(node.type)}</text>
        <text x="34" y="42" class="graph-node-label">${this.escapeHtml(this.trimLabel(node.label || node.id, 22))}</text>
        <title>${this.escapeHtml(node.label || node.id)}</title>
      </g>`;
    }).join('');

    canvas.innerHTML = `
      <svg class="graph-svg" aria-label="Execution graph" data-scale="${this.transform.scale.toFixed(2)}">
        <defs>
          <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z"></path>
          </marker>
        </defs>
        <rect class="graph-pan-surface" x="0" y="0" width="100%" height="100%"></rect>
        <g class="graph-stage" transform="${this.transformString()}">
          <rect class="graph-bounds" x="0" y="0" width="${layout.bounds.width}" height="${layout.bounds.height}" rx="18"></rect>
          <g class="graph-edges">${edgeMarkup}</g>
          <g class="graph-nodes">${nodeMarkup}</g>
        </g>
      </svg>
    `;

    this.bindGraphInteractions(canvas.querySelector('.graph-svg'));
  },

  bindGraphInteractions(svg) {
    if (!svg) return;
    svg.querySelectorAll('[data-node-id]').forEach((el) => {
      const select = () => {
        this.selectedNodeId = el.dataset.nodeId;
        this.renderGraph();
        this.renderNodeDetail();
      };
      el.addEventListener('click', (event) => { event.stopPropagation(); select(); });
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
    });
    svg.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-node-id]')) return;
      this.isPanning = true;
      this.panStart = { x: event.clientX, y: event.clientY, transform: { ...this.transform } };
      svg.classList.add('panning');
      svg.setPointerCapture?.(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (!this.isPanning || !this.panStart) return;
      this.transform = {
        ...this.transform,
        x: this.panStart.transform.x + event.clientX - this.panStart.x,
        y: this.panStart.transform.y + event.clientY - this.panStart.y,
      };
      this.applyTransform();
    });
    const stopPan = (event) => {
      this.isPanning = false;
      this.panStart = null;
      svg.classList.remove('panning');
      if (event?.pointerId !== undefined) svg.releasePointerCapture?.(event.pointerId);
    };
    svg.addEventListener('pointerup', stopPan);
    svg.addEventListener('pointercancel', stopPan);
    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      this.zoomBy(factor, { x: event.offsetX, y: event.offsetY });
    }, { passive: false });
  },

  transformString() {
    return `translate(${this.transform.x}, ${this.transform.y}) scale(${this.transform.scale})`;
  },

  applyTransform() {
    const stage = document.querySelector('#graph-canvas .graph-stage');
    const svg = document.querySelector('#graph-canvas .graph-svg');
    if (stage) stage.setAttribute('transform', this.transformString());
    if (svg) svg.dataset.scale = this.transform.scale.toFixed(2);
  },

  getViewportSize() {
    const canvas = document.getElementById('graph-canvas');
    return {
      width: Math.max(320, canvas?.clientWidth || 960),
      height: Math.max(280, canvas?.clientHeight || 560),
    };
  },

  fitToView({ render = true } = {}) {
    if (!this.layout) return;
    this.transform = window.GraphLayout.calculateFitTransform(this.layout.bounds, this.getViewportSize(), { padding: 42, maxScale: 1.12, minScale: 0.25 });
    if (render) this.applyTransform();
  },

  resetView() {
    this.transform = { x: 36, y: 36, scale: 1 };
    this.applyTransform();
  },

  zoomBy(factor, point = null) {
    const oldScale = this.transform.scale;
    const scale = window.GraphLayout.clampScale(oldScale * factor, 0.25, 2.4);
    const viewport = this.getViewportSize();
    const anchor = point || { x: viewport.width / 2, y: viewport.height / 2 };
    const ratio = scale / oldScale;
    this.transform = {
      scale,
      x: Math.round(anchor.x - (anchor.x - this.transform.x) * ratio),
      y: Math.round(anchor.y - (anchor.y - this.transform.y) * ratio),
    };
    this.applyTransform();
  },

  renderNodeDetail() {
    const detail = document.getElementById('graph-node-detail');
    if (!detail || !this.graph) return;
    const node = this.graph.nodes.find(item => item.id === this.selectedNodeId) || this.graph.nodes[0];
    if (!node) {
      detail.innerHTML = '<div class="empty-msg">No node selected.</div>';
      return;
    }
    const relatedEdges = this.graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
    detail.innerHTML = `
      <div class="node-detail-header">
        <span class="node-type-pill ${this.escapeAttribute(node.type)}">${this.escapeHtml(node.type)}</span>
        <h3>${this.escapeHtml(node.label || node.id)}</h3>
        <p>${this.escapeHtml(node.status || 'observed')}${node.metadata?.risk ? ` · ${this.escapeHtml(node.metadata.risk)}` : ''}${node.metadata?.scopeStatus ? ` · ${this.escapeHtml(node.metadata.scopeStatus)}` : ''}</p>
      </div>
      ${node.metadata?.contentUrl ? `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${this.escapeAttribute(node.metadata.contentUrl)}">Open artifact</a>` : ''}
      <div class="node-detail-section"><h4>Edges</h4>${relatedEdges.length ? `<ul>${relatedEdges.map(edge => `<li><code>${this.escapeHtml(edge.type)}</code> ${this.escapeHtml(edge.source)} → ${this.escapeHtml(edge.target)}</li>`).join('')}</ul>` : '<p>No related edges.</p>'}</div>
      <div class="node-detail-section"><h4>Metadata</h4><pre>${this.escapeHtml(JSON.stringify(node.metadata || {}, null, 2))}</pre></div>
    `;
  },

  async exportGraph() {
    if (!this.selectedRunId) return;
    const button = document.getElementById('export-graph-btn');
    const original = button?.textContent || 'Export snapshot';
    if (button) {
      button.disabled = true;
      button.textContent = 'Exporting…';
    }
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(this.selectedRunId)}/artifacts/graph`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const artifact = await res.json();
      window.dispatchEvent(new CustomEvent('phantom:artifact', { detail: { artifact, runId: this.selectedRunId } }));
      await this.loadGraph(this.selectedRunId, { fit: false });
      if (button) button.textContent = 'Exported ✓';
      setTimeout(() => { if (button) button.textContent = original; }, 1200);
    } catch (err) {
      if (button) button.textContent = `Failed: ${err.message}`;
      setTimeout(() => { if (button) button.textContent = original; }, 1600);
    } finally {
      if (button) button.disabled = false;
    }
  },

  trimLabel(value, max) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
