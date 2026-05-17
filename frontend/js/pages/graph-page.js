window.GraphPage = {
  runs: [],
  selectedRunId: null,
  graph: null,
  selectedNodeId: null,
  refreshTimer: null,

  init() {
    document.getElementById('refresh-graph-btn')?.addEventListener('click', () => this.loadRuns(this.selectedRunId));
    document.getElementById('export-graph-btn')?.addEventListener('click', () => this.exportGraph());
    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'graph') this.loadRuns(this.selectedRunId);
    });
    window.addEventListener('phantom:trace', (event) => {
      const runId = event.detail?.runId;
      if (!runId || window.Router?.current !== 'graph') return;
      if (!this.selectedRunId || this.selectedRunId === runId) this.scheduleGraphRefresh(runId);
    });
    window.addEventListener('phantom:artifact', (event) => {
      const runId = event.detail?.runId;
      if (runId && window.Router?.current === 'graph' && this.selectedRunId === runId) this.scheduleGraphRefresh(runId);
    });
    if (window.Router?.current === 'graph') setTimeout(() => this.loadRuns(this.selectedRunId), 0);
  },

  scheduleGraphRefresh(runId) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.loadGraph(runId), 250);
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
      const runToSelect = selectRunId || this.runs[0]?.id;
      if (runToSelect) await this.loadGraph(runToSelect);
      else this.renderEmptyGraph();
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
      const item = document.createElement('button');
      item.className = `run-list-item${run.id === this.selectedRunId ? ' active' : ''}`;
      item.innerHTML = `
        <span class="run-status ${this.escapeHtml(run.status)}"></span>
        <span class="run-list-body">
          <strong>${this.escapeHtml(run.title || run.goal || 'Untitled Run')}</strong>
          <small>${this.escapeHtml(run.model || 'model unknown')} · ${this.escapeHtml(run.scope?.name || 'no scope')} · ${this.escapeHtml(run.started_at || '')}</small>
        </span>
      `;
      item.addEventListener('click', () => this.loadGraph(run.id));
      list.appendChild(item);
    });
  },

  async loadGraph(runId) {
    if (!runId) return;
    this.selectedRunId = runId;
    this.renderRunsList();
    const canvas = document.getElementById('graph-canvas');
    if (canvas) canvas.innerHTML = '<div class="empty-msg">Deriving graph from trace events…</div>';
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/graph`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.graph = await res.json();
      if (!this.selectedNodeId || !this.graph.nodes.some(node => node.id === this.selectedNodeId)) {
        this.selectedNodeId = this.graph.nodes[0]?.id || null;
      }
      this.renderGraph();
      this.renderNodeDetail();
    } catch (err) {
      if (canvas) canvas.innerHTML = `<div class="empty-msg danger">Failed to load graph: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderEmptyGraph() {
    document.getElementById('graph-canvas').innerHTML = '<div class="empty-msg">Select a run to render its execution graph.</div>';
    document.getElementById('graph-node-detail').innerHTML = '<div class="empty-msg">No node selected.</div>';
    document.getElementById('graph-stats').textContent = 'No graph loaded';
  },

  renderGraph() {
    const canvas = document.getElementById('graph-canvas');
    const stats = document.getElementById('graph-stats');
    if (!canvas || !this.graph) return;
    const layout = this.layoutNodes(this.graph.nodes, this.graph.edges);
    const width = 980;
    const height = Math.max(420, layout.height);
    const nodeMap = new Map(layout.nodes.map(node => [node.id, node]));

    if (stats) {
      const blocked = this.graph.nodes.filter(node => node.status === 'blocked').length;
      stats.textContent = `${this.graph.stats?.nodes || this.graph.nodes.length} nodes · ${this.graph.stats?.edges || this.graph.edges.length} edges · ${this.graph.stats?.events || 0} events · ${this.graph.stats?.artifacts || 0} artifacts${blocked ? ` · ${blocked} blocked` : ''}`;
    }

    const edgeMarkup = this.graph.edges.map((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return '';
      const x1 = source.x + 86;
      const y1 = source.y + 26;
      const x2 = target.x + 10;
      const y2 = target.y + 26;
      const mid = Math.max(x1 + 40, (x1 + x2) / 2);
      return `<path class="graph-edge ${this.escapeAttribute(edge.type)} ${edge.type === 'blocked_by_policy' ? 'blocked' : ''}" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" marker-end="url(#graph-arrow)"><title>${this.escapeHtml(edge.type || 'edge')}</title></path>`;
    }).join('');

    const nodeMarkup = layout.nodes.map((node) => `
      <g class="graph-node ${this.escapeAttribute(node.type)} ${this.escapeAttribute(node.status || '')} ${node.id === this.selectedNodeId ? 'selected' : ''}" data-node-id="${this.escapeAttribute(node.id)}" transform="translate(${node.x}, ${node.y})" tabindex="0" role="button">
        <rect rx="12" width="172" height="58"></rect>
        <circle cx="18" cy="29" r="7"></circle>
        <text x="34" y="24" class="graph-node-type">${this.escapeHtml(node.type)}</text>
        <text x="34" y="42" class="graph-node-label">${this.escapeHtml(this.trimLabel(node.label || node.id, 22))}</text>
        <title>${this.escapeHtml(node.label || node.id)}</title>
      </g>
    `).join('');

    canvas.innerHTML = `
      <svg class="graph-svg" viewBox="0 0 ${width} ${height}" aria-label="Execution graph">
        <defs>
          <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z"></path>
          </marker>
        </defs>
        <g class="graph-edges">${edgeMarkup}</g>
        <g class="graph-nodes">${nodeMarkup}</g>
      </svg>
    `;

    canvas.querySelectorAll('[data-node-id]').forEach((el) => {
      const select = () => {
        this.selectedNodeId = el.dataset.nodeId;
        this.renderGraph();
        this.renderNodeDetail();
      };
      el.addEventListener('click', select);
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
    });
  },

  layoutNodes(nodes, edges) {
    const columns = {
      run: 30,
      tool: 250,
      command: 250,
      host: 500,
      url: 500,
      port: 720,
      artifact: 720,
      error: 720,
    };
    const buckets = new Map();
    nodes.forEach((node) => {
      const x = columns[node.type] ?? 500;
      if (!buckets.has(x)) buckets.set(x, []);
      buckets.get(x).push(node);
    });

    const positioned = [];
    let maxHeight = 0;
    Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).forEach(([x, bucket]) => {
      bucket.sort((a, b) => (a.seq || 0) - (b.seq || 0) || String(a.label).localeCompare(String(b.label)));
      bucket.forEach((node, index) => {
        const y = 24 + index * 86;
        maxHeight = Math.max(maxHeight, y + 86);
        positioned.push({ ...node, x, y });
      });
    });
    return { nodes: positioned, edges, height: maxHeight + 24 };
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
      await this.loadGraph(this.selectedRunId);
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
