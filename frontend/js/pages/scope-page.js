window.ScopePage = {
  scopes: [],
  selectedScopeId: null,

  init() {
    document.getElementById('refresh-scopes-btn')?.addEventListener('click', () => this.loadScopes());
    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'scope') this.loadScopes();
    });
    this.loadScopesForSelector();
  },

  async loadScopes(selectId = this.selectedScopeId) {
    const list = document.getElementById('scope-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-msg">Loading scopes…</div>';
    try {
      const res = await fetch('/api/scopes');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.scopes = await res.json();
      this.renderList();
      this.renderDetail(selectId || this.scopes[0]?.id || null);
      this.renderActiveSelector();
    } catch (err) {
      list.innerHTML = `<div class="empty-msg danger">Failed to load scopes: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  async loadScopesForSelector() {
    try {
      const res = await fetch('/api/scopes');
      if (!res.ok) return;
      this.scopes = await res.json();
      this.renderActiveSelector();
    } catch {}
  },

  renderActiveSelector() {
    const select = document.getElementById('active-scope-select');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">No scope selected</option>' + this.scopes.map(scope => `<option value="${this.escapeAttribute(scope.id)}">${this.escapeHtml(scope.name)}</option>`).join('');
    select.value = current || '';
  },

  renderList() {
    const list = document.getElementById('scope-list');
    if (!list) return;
    const create = document.createElement('button');
    create.className = 'btn btn-primary btn-sm';
    create.textContent = '+ New scope';
    create.addEventListener('click', () => this.renderEditor());
    list.innerHTML = '';
    list.appendChild(create);
    if (!this.scopes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-msg';
      empty.textContent = 'No scopes yet. Create one before risky network work.';
      list.appendChild(empty);
      return;
    }
    this.scopes.forEach((scope) => {
      const item = document.createElement('button');
      item.className = `run-list-item${scope.id === this.selectedScopeId ? ' active' : ''}`;
      item.innerHTML = `<span class="run-list-body"><strong>${this.escapeHtml(scope.name)}</strong><small>${this.escapeHtml(scope.expires_at || 'no expiry')}</small></span>`;
      item.addEventListener('click', () => this.renderDetail(scope.id));
      list.appendChild(item);
    });
  },

  renderDetail(id) {
    const detail = document.getElementById('scope-detail');
    if (!detail) return;
    const scope = this.scopes.find(item => item.id === id);
    if (!scope) return this.renderEditor();
    this.selectedScopeId = id;
    this.renderList();
    detail.innerHTML = `
      <div class="run-detail-header"><div><h3>${this.escapeHtml(scope.name)}</h3><p>${this.escapeHtml(scope.notes || 'No ROE notes.')}</p></div><span class="run-pill running">active</span></div>
      <div class="run-meta-grid">
        <div><span>Hosts</span><strong>${this.escapeHtml((scope.targets?.hosts || []).join(', ') || '—')}</strong></div>
        <div><span>Domains</span><strong>${this.escapeHtml((scope.targets?.domains || []).join(', ') || '—')}</strong></div>
        <div><span>CIDRs</span><strong>${this.escapeHtml((scope.targets?.cidrs || []).join(', ') || '—')}</strong></div>
        <div><span>URLs</span><strong>${this.escapeHtml((scope.targets?.urls || []).join(', ') || '—')}</strong></div>
        <div><span>Allowed</span><strong>${this.escapeHtml((scope.allowed_actions || []).join(', ') || 'default')}</strong></div>
        <div><span>Blocked</span><strong>${this.escapeHtml((scope.blocked_actions || []).join(', ') || '—')}</strong></div>
      </div>
      <div class="run-actions">
        <button class="btn btn-secondary btn-sm" data-action="use">Use for chat</button>
        <button class="btn btn-secondary btn-sm" data-action="edit">Edit</button>
        <button class="btn btn-secondary btn-sm" data-action="archive">Archive</button>
      </div>`;
    detail.querySelector('[data-action="use"]')?.addEventListener('click', () => {
      const select = document.getElementById('active-scope-select');
      if (select) select.value = scope.id;
    });
    detail.querySelector('[data-action="edit"]')?.addEventListener('click', () => this.renderEditor(scope));
    detail.querySelector('[data-action="archive"]')?.addEventListener('click', () => this.archiveScope(scope.id));
  },

  renderEditor(scope = null) {
    const detail = document.getElementById('scope-detail');
    if (!detail) return;
    const targets = scope?.targets || {};
    detail.innerHTML = `
      <div class="run-detail-header"><h3>${scope ? 'Edit scope' : 'New scope'}</h3></div>
      <div class="scope-editor">
        <input id="scope-name" placeholder="Scope name" value="${this.escapeAttribute(scope?.name || '')}">
        <input id="scope-hosts" placeholder="Hosts comma-separated" value="${this.escapeAttribute((targets.hosts || []).join(', '))}">
        <input id="scope-domains" placeholder="Domains comma-separated" value="${this.escapeAttribute((targets.domains || []).join(', '))}">
        <input id="scope-cidrs" placeholder="CIDRs comma-separated" value="${this.escapeAttribute((targets.cidrs || []).join(', '))}">
        <input id="scope-urls" placeholder="URLs comma-separated" value="${this.escapeAttribute((targets.urls || []).join(', '))}">
        <input id="scope-allowed" placeholder="Allowed risks e.g. recon, network-scan" value="${this.escapeAttribute((scope?.allowed_actions || []).join(', '))}">
        <input id="scope-blocked" placeholder="Blocked risks e.g. destructive, exploit" value="${this.escapeAttribute((scope?.blocked_actions || []).join(', '))}">
        <input id="scope-expires" placeholder="Expires ISO timestamp" value="${this.escapeAttribute(scope?.expires_at || '')}">
        <textarea id="scope-notes" rows="5" placeholder="Rules of engagement">${this.escapeHtml(scope?.notes || '')}</textarea>
        <button id="save-scope-btn" class="btn btn-primary">Save scope</button>
      </div>`;
    detail.querySelector('#save-scope-btn')?.addEventListener('click', () => this.saveScope(scope?.id || null));
  },

  csv(id) {
    return (document.getElementById(id)?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  },

  async saveScope(id) {
    const payload = {
      name: document.getElementById('scope-name')?.value || 'Untitled scope',
      targets: { hosts: this.csv('scope-hosts'), domains: this.csv('scope-domains'), cidrs: this.csv('scope-cidrs'), urls: this.csv('scope-urls') },
      allowedActions: this.csv('scope-allowed'),
      blockedActions: this.csv('scope-blocked'),
      notes: document.getElementById('scope-notes')?.value || '',
      expiresAt: document.getElementById('scope-expires')?.value || null,
    };
    const res = await fetch(id ? `/api/scopes/${encodeURIComponent(id)}` : '/api/scopes', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();
    await this.loadScopes(saved.id);
  },

  async archiveScope(id) {
    const res = await fetch(`/api/scopes/${encodeURIComponent(id)}/archive`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await this.loadScopes();
  },

  escapeHtml(value) { const div = document.createElement('div'); div.textContent = value == null ? '' : String(value); return div.innerHTML; },
  escapeAttribute(value) { return this.escapeHtml(value).replace(/"/g, '&quot;'); },
};
