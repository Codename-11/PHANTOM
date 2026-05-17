window.GraphPage = {
  runs: [],
  selectedRunId: null,
  graph: null,
  replayBundle: null,
  replaySteps: [],
  activeReplayIndex: 0,
  replayTimer: null,
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
    document.getElementById('graph-replay-prev-btn')?.addEventListener('click', () => this.stepReplay(-1));
    document.getElementById('graph-replay-next-btn')?.addEventListener('click', () => this.stepReplay(1));
    document.getElementById('graph-replay-play-btn')?.addEventListener('click', () => this.toggleReplayPlayback());
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
    this.renderReplayControls();
    if (window.Router?.current === 'graph') setTimeout(() => this.loadRuns(this.selectedRunId), 0);
  },

  presenter() {
    return window.GraphPresenter || {
      formatToolName: (name) => String(name || 'Tool call').replace(/[_-]+/g, ' '),
      edgeExplanation: (edge) => edge.label || edge.type || 'relationship',
      wrapNodeLabel: (value) => ({ title: String(value || ''), lines: [this.trimLabel(value, 24)], truncated: false }),
      summarizeMetadata: (metadata) => Object.entries(metadata || {}).map(([key, value]) => ({ key, label: key, value: typeof value === 'string' ? value : JSON.stringify(value) })),
      eventKindLabel: (event) => event.title || event.type || 'Trace event',
    };
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
      item.title = run.title || run.goal || 'Untitled Run';
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
        this.activeReplayIndex = 0;
        this.stopReplayPlayback();
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
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/replay`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.replayBundle = await res.json();
      this.graph = this.replayBundle.graph;
      this.replaySteps = this.replayBundle.replay?.steps || [];
      if (this.activeReplayIndex >= this.replaySteps.length) this.activeReplayIndex = Math.max(0, this.replaySteps.length - 1);
      if (!this.selectedNodeId || !this.graph.nodes.some(node => node.id === this.selectedNodeId)) {
        this.selectedNodeId = this.activeStep()?.primaryNodeId || this.graph.nodes[0]?.id || null;
      }
      this.layout = window.GraphLayout.layoutGraph(this.graph);
      if (fit || this.shouldFitNext) {
        this.fitToView({ render: false });
        this.shouldFitNext = false;
      }
      this.renderGraph();
      this.renderNodeDetail();
      this.renderReplayControls();
      this.updateLiveIndicator();
    } catch (err) {
      if (canvas) canvas.innerHTML = `<div class="empty-msg danger">Failed to load replay graph: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderEmptyGraph() {
    const canvas = document.getElementById('graph-canvas');
    if (canvas) canvas.innerHTML = '<div class="empty-msg">Select a run to render its execution graph.</div>';
    const detail = document.getElementById('graph-node-detail');
    if (detail) detail.innerHTML = '<div class="empty-msg">No node selected.</div>';
    const stats = document.getElementById('graph-stats');
    if (stats) stats.textContent = 'No graph loaded';
    this.replayBundle = null;
    this.replaySteps = [];
    this.renderReplayControls();
  },

  activeStep() {
    return this.replaySteps[this.activeReplayIndex] || null;
  },

  setReplayIndex(index, { center = true } = {}) {
    if (!this.replaySteps.length) return;
    const max = this.replaySteps.length - 1;
    this.activeReplayIndex = Math.max(0, Math.min(max, index));
    const step = this.activeStep();
    if (step?.primaryNodeId) this.selectedNodeId = step.primaryNodeId;
    if (center) this.centerNode(this.selectedNodeId);
    this.renderGraph();
    this.renderNodeDetail();
    this.renderReplayControls();
  },

  stepReplay(delta) {
    this.stopReplayPlayback();
    this.setReplayIndex(this.activeReplayIndex + delta);
  },

  toggleReplayPlayback() {
    if (this.replayTimer) {
      this.stopReplayPlayback();
      return;
    }
    if (!this.replaySteps.length) return;
    if (this.activeReplayIndex >= this.replaySteps.length - 1) this.activeReplayIndex = 0;
    this.setReplayIndex(this.activeReplayIndex, { center: true });
    this.replayTimer = setInterval(() => {
      if (this.activeReplayIndex >= this.replaySteps.length - 1) {
        this.stopReplayPlayback();
        return;
      }
      this.setReplayIndex(this.activeReplayIndex + 1, { center: true });
    }, 1150);
    this.renderReplayControls();
  },

  stopReplayPlayback() {
    if (this.replayTimer) clearInterval(this.replayTimer);
    this.replayTimer = null;
    this.renderReplayControls();
  },

  centerNode(nodeId) {
    if (!nodeId || !this.layout) return;
    const node = this.layout.nodes.find(item => item.id === nodeId);
    if (!node) return;
    const viewport = this.getViewportSize();
    const scale = this.transform.scale || 1;
    this.transform = {
      scale,
      x: Math.round(viewport.width / 2 - (node.x + this.layout.nodeWidth / 2) * scale),
      y: Math.round(viewport.height / 2 - (node.y + this.layout.nodeHeight / 2) * scale),
    };
  },

  renderReplayControls() {
    const panel = document.getElementById('graph-replay-panel');
    const prev = document.getElementById('graph-replay-prev-btn');
    const play = document.getElementById('graph-replay-play-btn');
    const next = document.getElementById('graph-replay-next-btn');
    const step = this.activeStep();
    const hasSteps = this.replaySteps.length > 0;
    [prev, play, next].forEach(button => { if (button) button.disabled = !hasSteps; });
    if (play) {
      play.setAttribute('aria-pressed', String(Boolean(this.replayTimer)));
      play.textContent = this.replayTimer ? '⏸ Pause' : '▶ Replay';
      play.classList.toggle('active', Boolean(this.replayTimer));
    }
    if (!panel) return;
    if (!hasSteps) {
      panel.innerHTML = '<span class="graph-replay-status">No replay steps yet</span>';
      return;
    }
    const summary = this.replayBundle?.replay || {};
    panel.innerHTML = `
      <div class="graph-replay-summary">
        <strong>Replay ${this.activeReplayIndex + 1}/${this.replaySteps.length}</strong>
        <span>${this.escapeHtml(step?.title || 'Trace event')}</span>
        <small>${this.escapeHtml(step?.phase || 'general')} · ${this.escapeHtml(step?.status || 'observed')}${summary.blockedActions ? ` · ${summary.blockedActions} blocked` : ''}</small>
      </div>
      <div class="graph-replay-track" role="list" aria-label="Replay event steps">
        ${this.replaySteps.map((item, index) => `<button type="button" role="listitem" class="graph-replay-dot ${index === this.activeReplayIndex ? 'active' : ''} ${this.escapeAttribute(item.status || '')}" data-replay-index="${index}" title="#${item.seq} ${this.escapeAttribute(item.title || item.type)}"></button>`).join('')}
      </div>
    `;
    panel.querySelectorAll('[data-replay-index]').forEach((button) => {
      button.addEventListener('click', () => {
        this.stopReplayPlayback();
        this.setReplayIndex(Number(button.dataset.replayIndex), { center: true });
      });
    });
  },

  renderGraph() {
    const canvas = document.getElementById('graph-canvas');
    const stats = document.getElementById('graph-stats');
    if (!canvas || !this.graph || !this.layout) return;
    const layout = this.layout;
    const nodeMap = new Map(layout.nodes.map(node => [node.id, node]));
    const step = this.activeStep();
    const replayNodeIds = new Set(step?.nodeIds || []);
    const replayEdgeIds = new Set(step?.edgeIds || []);
    const selectedEdges = new Set((this.graph.edges || [])
      .filter(edge => edge.source === this.selectedNodeId || edge.target === this.selectedNodeId)
      .flatMap(edge => [edge.id || `${edge.type}:${edge.source}->${edge.target}`, edge.source, edge.target]));

    if (stats) {
      const blocked = this.graph.nodes.filter(node => node.status === 'blocked').length;
      const liveText = this.followLive ? ' · follow on' : ' · follow paused';
      const replayText = this.replaySteps.length ? ` · replay ${this.activeReplayIndex + 1}/${this.replaySteps.length}` : '';
      stats.textContent = `${this.graph.stats?.nodes || this.graph.nodes.length} nodes · ${this.graph.stats?.edges || this.graph.edges.length} edges · ${this.graph.stats?.events || 0} events · ${this.graph.stats?.artifacts || 0} artifacts${blocked ? ` · ${blocked} blocked` : ''}${replayText}${liveText}`;
    }

    const edgeMarkup = layout.edges.map((edge) => {
      if (!edge.path) return '';
      const id = edge.id || `${edge.type}:${edge.source}->${edge.target}`;
      const related = !this.selectedNodeId || edge.source === this.selectedNodeId || edge.target === this.selectedNodeId;
      const replayActive = replayEdgeIds.has(id) || edge.eventId === step?.eventId;
      return `<path class="graph-edge ${this.escapeAttribute(edge.type)} ${edge.type === 'blocked_by_policy' ? 'blocked' : ''} ${replayActive ? 'replay-active' : ''} ${related || replayActive ? 'related' : 'dimmed'}" d="${this.escapeAttribute(edge.path)}" marker-end="url(#graph-arrow)"><title>${this.escapeHtml(this.presenter().edgeExplanation(edge))}</title></path>`;
    }).join('');

    const edgeLabels = layout.edges.map((edge) => {
      const id = edge.id || `${edge.type}:${edge.source}->${edge.target}`;
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return '';
      const related = edge.source === this.selectedNodeId || edge.target === this.selectedNodeId || replayEdgeIds.has(id) || edge.eventId === step?.eventId;
      if (!related) return '';
      const x = Math.round((source.x + layout.nodeWidth + target.x) / 2);
      const y = Math.round((source.y + target.y) / 2 + layout.nodeHeight / 2 - 8);
      return `<text class="graph-edge-label ${this.escapeAttribute(edge.type)}" x="${x}" y="${y}">${this.escapeHtml(this.presenter().edgeExplanation(edge))}</text>`;
    }).join('');

    const nodeMarkup = layout.nodes.map((node) => {
      const related = !this.selectedNodeId || node.id === this.selectedNodeId || selectedEdges.has(node.id) || replayNodeIds.has(node.id);
      const replayActive = replayNodeIds.has(node.id);
      const label = this.presenter().wrapNodeLabel(node.label || node.id, { maxLineLength: 28, maxLines: 2 });
      return `
      <g class="graph-node ${this.escapeAttribute(node.type)} ${this.escapeAttribute(node.status || '')} ${node.id === this.selectedNodeId ? 'selected' : ''} ${replayActive ? 'replay-active' : ''} ${related ? 'related' : 'dimmed'}" data-node-id="${this.escapeAttribute(node.id)}" transform="translate(${node.x}, ${node.y})" tabindex="0" role="button" aria-label="${this.escapeAttribute(label.title)}">
        <rect rx="12" width="${layout.nodeWidth}" height="${layout.nodeHeight}"></rect>
        <circle cx="18" cy="29" r="7"></circle>
        <text x="34" y="20" class="graph-node-type">${this.escapeHtml(this.nodeTypeLabel(node))}</text>
        <text x="34" y="38" class="graph-node-label">${label.lines.map((line, index) => `<tspan x="34" dy="${index === 0 ? 0 : 15}">${this.escapeHtml(line)}</tspan>`).join('')}</text>
        <title>${this.escapeHtml(label.title)}</title>
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
          <g class="graph-edge-labels">${edgeLabels}</g>
          <g class="graph-nodes">${nodeMarkup}</g>
        </g>
      </svg>
    `;

    this.bindGraphInteractions(canvas.querySelector('.graph-svg'));
  },

  nodeTypeLabel(node) {
    if (node.type === 'tool') return this.presenter().formatToolName(node.label);
    return node.type;
  },

  bindGraphInteractions(svg) {
    if (!svg) return;
    svg.querySelectorAll('[data-node-id]').forEach((el) => {
      const select = () => {
        this.stopReplayPlayback();
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
    const step = this.activeStep();
    const stepMatchesNode = step?.nodeIds?.includes(node.id);
    const metadataRows = this.presenter().summarizeMetadata(node.metadata || {});
    detail.innerHTML = `
      <div class="node-detail-header">
        <span class="node-type-pill ${this.escapeAttribute(node.type)}">${this.escapeHtml(this.nodeTypeLabel(node))}</span>
        <h3>${this.escapeHtml(node.label || node.id)}</h3>
        <p>${this.escapeHtml(node.status || 'observed')}${node.metadata?.risk ? ` · ${this.escapeHtml(node.metadata.risk)}` : ''}${node.metadata?.scopeStatus ? ` · ${this.escapeHtml(node.metadata.scopeStatus)}` : ''}</p>
      </div>
      ${step ? `<div class="node-detail-section replay-step-card ${stepMatchesNode ? 'active' : ''}"><h4>Replay step #${this.escapeHtml(step.seq)}</h4><strong>${this.escapeHtml(step.title)}</strong><p>${this.escapeHtml(step.explanation || '')}</p>${step.outputPreview ? `<pre>${this.escapeHtml(step.outputPreview)}</pre>` : ''}${step.artifacts?.length ? `<div class="artifact-chip-row">${step.artifacts.map(artifact => `<a class="artifact-chip" target="_blank" rel="noopener" href="${this.escapeAttribute(artifact.contentUrl || artifact.downloadUrl || '#')}">${this.escapeHtml(artifact.title || artifact.id)}</a>`).join('')}</div>` : ''}</div>` : ''}
      ${node.metadata?.contentUrl ? `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${this.escapeAttribute(node.metadata.contentUrl)}">Open artifact</a>` : ''}
      <div class="node-detail-section"><h4>Relationships</h4>${relatedEdges.length ? `<ul>${relatedEdges.map(edge => `<li><strong>${this.escapeHtml(this.presenter().edgeExplanation(edge))}</strong><br><code>${this.escapeHtml(this.nodeLabel(edge.source))}</code> → <code>${this.escapeHtml(this.nodeLabel(edge.target))}</code></li>`).join('')}</ul>` : '<p>No related edges.</p>'}</div>
      <div class="node-detail-section"><h4>Metadata</h4>${metadataRows.length ? `<dl class="metadata-list">${metadataRows.map(row => `<dt>${this.escapeHtml(row.label)}</dt><dd>${this.escapeHtml(row.value)}</dd>`).join('')}</dl>` : '<p>No metadata.</p>'}</div>
    `;
  },

  nodeLabel(nodeId) {
    const node = this.graph?.nodes?.find(item => item.id === nodeId);
    return node?.label || nodeId;
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
