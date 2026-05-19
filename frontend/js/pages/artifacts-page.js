window.ArtifactsPage = {
  artifacts: [],
  selectedArtifactId: null,
  activeType: '',

  init() {
    document.getElementById('refresh-artifacts-btn')?.addEventListener('click', () => this.loadArtifacts());
    // Legacy <select id="artifact-type-filter"> support — kept for backward compatibility if any embed still uses it.
    document.getElementById('artifact-type-filter')?.addEventListener('change', (event) => {
      this.activeType = event.target.value;
      this.loadArtifacts(null);
    });
    // Filter-chip row (kit alignment pass 6).
    const chipRow = document.getElementById('artifacts-filter-chips');
    if (chipRow) {
      chipRow.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-artifact-filter]');
        if (!chip) return;
        const value = chip.dataset.artifactFilter;
        this.activeType = value === 'all' ? '' : value;
        chipRow.querySelectorAll('[data-artifact-filter]').forEach((c) => c.classList.toggle('active', c === chip));
        this.loadArtifacts(null);
      });
    }

    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'artifacts') this.loadArtifacts();
    });

    window.addEventListener('phantom:artifact', (event) => {
      const artifact = event.detail?.artifact;
      if (!artifact) return;
      if (window.Router?.current === 'artifacts') this.loadArtifacts(artifact.id);
    });
  },

  async loadArtifacts(selectArtifactId = this.selectedArtifactId) {
    const list = document.getElementById('artifacts-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-msg">Loading artifacts…</div>';
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (this.activeType) params.set('type', this.activeType);
      const res = await fetch(`/api/artifacts?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.artifacts = await res.json();
      this.renderArtifactsList();
      const artifactToSelect = selectArtifactId || this.artifacts[0]?.id;
      if (artifactToSelect) await this.selectArtifact(artifactToSelect);
      else this.renderEmptyDetail();
    } catch (err) {
      list.innerHTML = `<div class="empty-msg danger">Failed to load artifacts: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderArtifactsList() {
    const list = document.getElementById('artifacts-list');
    const countEl = document.getElementById('art-ct-all');
    if (countEl) countEl.textContent = String(this.artifacts.length);
    if (!this.artifacts.length) {
      list.innerHTML = '<div class="empty-msg">No artifacts yet. Run outputs and previews will appear here.</div>';
      return;
    }
    list.innerHTML = '';
    this.artifacts.forEach((artifact) => {
      const item = document.createElement('button');
      item.className = `artifact-list-item${artifact.id === this.selectedArtifactId ? ' active' : ''}`;
      item.innerHTML = `
        <span class="artifact-type-badge ${this.escapeHtml(artifact.type || '')}">${this.iconForType(artifact.type)}</span>
        <span class="artifact-list-body">
          <strong>${this.escapeHtml(artifact.title || 'Untitled artifact')}</strong>
          <small>${this.escapeHtml(artifact.type || 'artifact')} · ${this.escapeHtml(artifact.createdAt || '')}</small>
        </span>
      `;
      item.addEventListener('click', () => this.selectArtifact(artifact.id));
      list.appendChild(item);
    });
  },

  async selectArtifact(id) {
    this.selectedArtifactId = id;
    this.renderArtifactsList();
    const detail = document.getElementById('artifact-detail');
    if (!detail) return;
    detail.innerHTML = '<div class="empty-msg">Loading artifact…</div>';
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const artifact = await res.json();
      detail.innerHTML = this.renderArtifactDetail(artifact);
      if (artifact.mimeType?.startsWith('text/') || artifact.type === 'jsonl') {
        this.loadTextPreview(artifact).catch(() => {});
      }
    } catch (err) {
      detail.innerHTML = `<div class="empty-msg danger">Failed to load artifact: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderArtifactDetail(artifact) {
    const metadataRows = Object.entries(artifact.metadata || {})
      .map(([key, value]) => `<div><span>${this.escapeHtml(key)}</span><strong>${this.escapeHtml(JSON.stringify(value))}</strong></div>`)
      .join('');
    const preview = artifact.type === 'html'
      ? `<iframe class="artifact-preview-frame" src="${this.escapeAttribute(artifact.contentUrl)}" sandbox="allow-scripts allow-forms allow-popups" title="${this.escapeAttribute(artifact.title || 'Artifact preview')}"></iframe>`
      : `<pre id="artifact-text-preview" class="artifact-text-preview">Text preview loading…</pre>`;

    return `
      <div class="artifact-detail-header">
        <div>
          <p class="eyebrow">${this.escapeHtml(artifact.type || 'artifact')}</p>
          <h3>${this.escapeHtml(artifact.title || 'Untitled artifact')}</h3>
          <p>${this.escapeHtml(artifact.mimeType || 'unknown mime')} · ${this.escapeHtml(artifact.createdAt || '')}</p>
        </div>
        <div class="artifact-actions">
          <a class="btn btn-secondary btn-sm" href="${this.escapeAttribute(artifact.contentUrl)}" target="_blank" rel="noopener">Open</a>
          <a class="btn btn-primary btn-sm" href="${this.escapeAttribute(artifact.downloadUrl)}">Download</a>
        </div>
      </div>
      <div class="artifact-meta-grid">
        <div><span>Run</span><strong>${this.escapeHtml(artifact.runId || '—')}</strong></div>
        <div><span>Conversation</span><strong>${this.escapeHtml(artifact.conversationId || '—')}</strong></div>
        ${metadataRows}
      </div>
      <div class="artifact-preview-shell">
        ${preview}
      </div>
    `;
  },

  async loadTextPreview(artifact) {
    const target = document.getElementById('artifact-text-preview');
    if (!target) return;
    const res = await fetch(artifact.contentUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    target.textContent = text.length > 20000 ? `${text.substring(0, 20000)}\n… truncated …` : text;
  },

  renderEmptyDetail() {
    const detail = document.getElementById('artifact-detail');
    if (detail) detail.innerHTML = '<div class="empty-msg">Select an artifact to preview or download it.</div>';
  },

  iconForType(type) {
    if (type === 'html') return '🌐';
    if (type === 'markdown') return '📝';
    if (type === 'jsonl') return '🧾';
    if (type === 'evidence') return '🧪';
    return '📦';
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
