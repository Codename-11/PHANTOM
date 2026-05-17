window.ScopePage = {
  assets: [],
  scopes: [],
  comparisons: [],
  selectedAssetId: null,
  selectedScopeId: null,
  mode: 'assets',
  assetFilter: { query: '', type: '' },

  init() {
    document.getElementById('refresh-scopes-btn')?.addEventListener('click', () => this.loadAll());
    document.getElementById('new-asset-btn')?.addEventListener('click', () => { this.mode = 'assets'; this.renderAssetEditor(); });
    document.getElementById('new-scope-btn')?.addEventListener('click', () => { this.mode = 'scopes'; this.renderScopeEditor(); });
    document.getElementById('asset-search')?.addEventListener('input', (event) => {
      this.assetFilter.query = event.target.value;
      this.loadAssets();
    });
    document.getElementById('asset-type-filter')?.addEventListener('change', (event) => {
      this.assetFilter.type = event.target.value;
      this.loadAssets();
    });
    document.querySelectorAll('[data-asset-mode]').forEach(button => {
      button.addEventListener('click', () => this.setMode(button.dataset.assetMode));
    });
    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'scope') this.loadAll();
    });
    this.loadScopesForSelector();
    if (window.Router?.current === 'scope') setTimeout(() => this.loadAll(), 0);
  },

  async loadAll() {
    await Promise.all([this.loadAssets(false), this.loadScopes(false), this.loadComparisons(false)]);
    await this.loadAssetOperationalDetails();
    this.renderCurrentMode();
    this.renderActiveSelector();
  },

  async loadAssetOperationalDetails() {
    if (!this.assets.length) return;
    const enriched = await Promise.all(this.assets.slice(0, 50).map(async (asset) => {
      try { return await this.fetchJSON(`/api/assets/${encodeURIComponent(asset.id)}`); }
      catch { return asset; }
    }));
    const byId = new Map(enriched.map(asset => [asset.id, asset]));
    this.assets = this.assets.map(asset => byId.get(asset.id) || asset);
  },

  async loadAssets(render = true) {
    const params = new URLSearchParams({ limit: '100' });
    if (this.assetFilter.query) params.set('query', this.assetFilter.query);
    if (this.assetFilter.type) params.set('type', this.assetFilter.type);
    const res = await fetch(`/api/assets?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed to load assets: HTTP ${res.status}`);
    this.assets = await res.json();
    if (!this.selectedAssetId && this.assets[0]) this.selectedAssetId = this.assets[0].id;
    if (render) this.renderCurrentMode();
  },

  async loadScopes(render = true) {
    const res = await fetch('/api/scopes');
    if (!res.ok) throw new Error(`Failed to load scopes: HTTP ${res.status}`);
    this.scopes = await res.json();
    if (!this.selectedScopeId && this.scopes[0]) this.selectedScopeId = this.scopes[0].id;
    if (render) this.renderCurrentMode();
  },

  async loadComparisons(render = true) {
    const res = await fetch('/api/comparisons');
    this.comparisons = res.ok ? await res.json() : [];
    if (render) this.renderCurrentMode();
  },

  async loadScopesForSelector() {
    try {
      await this.loadScopes(false);
      this.renderActiveSelector();
    } catch {}
  },

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('[data-asset-mode]').forEach(button => button.classList.toggle('active', button.dataset.assetMode === mode));
    this.renderCurrentMode();
  },

  renderCurrentMode() {
    document.querySelectorAll('[data-asset-mode]').forEach(button => button.classList.toggle('active', button.dataset.assetMode === this.mode));
    if (this.mode === 'scopes') return this.renderScopesWorkspace();
    if (this.mode === 'compare') return this.renderCompareWorkspace();
    return this.renderAssetsWorkspace();
  },

  renderActiveSelector() {
    const select = document.getElementById('active-scope-select');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">No scope selected</option>' + this.scopes.map(scope => `<option value="${this.escapeAttribute(scope.id)}">${this.escapeHtml(scope.name)}</option>`).join('');
    select.value = current || '';
  },

  renderAssetsWorkspace() {
    this.renderAssetList();
    const asset = this.assets.find(item => item.id === this.selectedAssetId) || this.assets[0];
    if (asset) this.selectAsset(asset.id, { fetchDetail: true });
    else this.renderEmptyAssets();
  },

  renderAssetList() {
    const list = document.getElementById('asset-list');
    if (!list) return;
    if (!this.assets.length) {
      list.innerHTML = '<div class="empty-msg">No assets yet. Create a network, device, service, or web app target.</div>';
      return;
    }
    list.innerHTML = this.assets.map(asset => `
      <button class="asset-list-item ${asset.id === this.selectedAssetId ? 'active' : ''}" data-asset-id="${this.escapeAttribute(asset.id)}">
        <span class="asset-type-icon">${this.iconForAsset(asset.type)}</span>
        <span class="asset-list-body">
          <strong>${this.escapeHtml(asset.name)}</strong>
          <small>${this.escapeHtml(asset.type)} · ${this.escapeHtml(asset.environment || 'no env')} · ${this.escapeHtml(asset.status || 'active')}</small>
        </span>
        <span class="health-dot ${this.healthClass(asset.status)}"></span>
      </button>
    `).join('');
    list.querySelectorAll('[data-asset-id]').forEach(button => button.addEventListener('click', () => this.selectAsset(button.dataset.assetId)));
  },

  async selectAsset(id, { fetchDetail = true } = {}) {
    this.selectedAssetId = id;
    this.renderAssetList();
    const main = document.getElementById('asset-main');
    const inspector = document.getElementById('asset-inspector');
    if (!main || !inspector) return;
    main.innerHTML = '<div class="empty-msg">Loading asset detail…</div>';
    try {
      const asset = fetchDetail ? await this.fetchJSON(`/api/assets/${encodeURIComponent(id)}`) : this.assets.find(item => item.id === id);
      main.innerHTML = this.renderAssetDetail(asset);
      inspector.innerHTML = this.renderAssetInspector(asset);
      this.bindAssetDetailActions(asset);
    } catch (err) {
      main.innerHTML = `<div class="empty-msg danger">${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderAssetDetail(asset) {
    const latestSnapshot = (asset.snapshots || [])[0];
    const openFindings = (asset.findings || []).filter(f => f.status === 'open').length;
    const mitigated = (asset.findings || []).filter(f => f.status === 'mitigated').length;
    return `
      <div class="asset-hero">
        <div>
          <p class="eyebrow">${this.escapeHtml(asset.type)}</p>
          <h2>${this.escapeHtml(asset.name)}</h2>
          <p>${this.escapeHtml(asset.notes || asset.description || 'No notes captured yet.')}</p>
          <div class="asset-chip-row">${(asset.tags || []).map(tag => `<span class="asset-chip">${this.escapeHtml(tag)}</span>`).join('') || '<span class="asset-chip muted">untagged</span>'}</div>
        </div>
        <div class="asset-health-card ${this.healthClass(latestSnapshot?.status || asset.status)}">
          <span>Health</span>
          <strong>${this.escapeHtml(latestSnapshot?.healthScore ?? '—')}</strong>
          <small>${this.escapeHtml(latestSnapshot?.status || asset.status || 'unknown')}</small>
        </div>
      </div>
      <div class="asset-metric-grid">
        <div><span>Open findings</span><strong>${openFindings}</strong></div>
        <div><span>Mitigated</span><strong>${mitigated}</strong></div>
        <div><span>Services</span><strong>${(asset.services || []).length}</strong></div>
        <div><span>Snapshots</span><strong>${(asset.snapshots || []).length}</strong></div>
      </div>
      <div class="asset-detail-tabs">
        <section><h3>Services</h3>${this.renderServices(asset.services || [])}</section>
        <section><h3>Findings</h3>${this.renderFindings(asset.findings || [])}</section>
        <section><h3>History / baselines</h3>${this.renderSnapshots(asset.snapshots || [])}</section>
        <section><h3>Targets</h3>${this.renderAddresses(asset.addresses || [])}</section>
      </div>`;
  },

  renderAssetInspector(asset) {
    return `
      <div class="inspector-card">
        <p class="eyebrow">Inspector</p>
        <h3>${this.escapeHtml(asset.name)}</h3>
        <div class="run-meta-grid compact">
          <div><span>Owner</span><strong>${this.escapeHtml(asset.owner || '—')}</strong></div>
          <div><span>Env</span><strong>${this.escapeHtml(asset.environment || '—')}</strong></div>
          <div><span>Criticality</span><strong>${this.escapeHtml(asset.criticality || 'medium')}</strong></div>
          <div><span>Cred refs</span><strong>${this.escapeHtml((asset.credentialRefs || []).join(', ') || '—')}</strong></div>
        </div>
        <div class="inspector-actions">
          <button class="btn btn-secondary btn-sm" data-action="edit-asset">Edit asset</button>
          <button class="btn btn-secondary btn-sm" data-action="snapshot">Add snapshot</button>
          <button class="btn btn-secondary btn-sm" data-action="finding">Add finding</button>
          <button class="btn btn-secondary btn-sm" data-action="scope-from-asset">Create scope</button>
        </div>
      </div>
      <div id="asset-action-panel" class="inspector-card muted-card">Select an action to update this asset.</div>`;
  },

  bindAssetDetailActions(asset) {
    document.querySelector('[data-action="edit-asset"]')?.addEventListener('click', () => this.renderAssetEditor(asset));
    document.querySelector('[data-action="snapshot"]')?.addEventListener('click', () => this.renderSnapshotEditor(asset));
    document.querySelector('[data-action="finding"]')?.addEventListener('click', () => this.renderFindingEditor(asset));
    document.querySelector('[data-action="scope-from-asset"]')?.addEventListener('click', () => this.renderScopeEditor(null, [asset.id]));
    document.querySelectorAll('[data-run-graph]').forEach(button => button.addEventListener('click', () => {
      if (window.GraphPage) window.GraphPage.selectedRunId = button.dataset.runGraph;
      window.Router?.navigate?.('graph');
      window.GraphPage?.loadGraph?.(button.dataset.runGraph);
    }));
  },

  renderServices(services) {
    if (!services.length) return '<div class="empty-msg">No services recorded.</div>';
    return `<div class="asset-table">${services.map(service => `
      <div><strong>${this.escapeHtml(service.name || service.url || 'service')}</strong><span>${this.escapeHtml(service.protocol || 'tcp')}/${this.escapeHtml(service.port || '—')} · ${this.escapeHtml(service.status || 'unknown')}</span></div>
    `).join('')}</div>`;
  },

  renderFindings(findings) {
    if (!findings.length) return '<div class="empty-msg">No findings linked to this asset.</div>';
    return `<div class="finding-list">${findings.map(finding => `
      <article class="finding-card ${this.escapeHtml(finding.severity)}">
        <div><strong>${this.escapeHtml(finding.title)}</strong><small>${this.escapeHtml(finding.severity)} · ${this.escapeHtml(finding.status)}</small></div>
        <p>${this.escapeHtml(finding.recommendation || finding.evidence || 'No recommendation captured.')}</p>
      </article>
    `).join('')}</div>`;
  },

  renderSnapshots(snapshots) {
    if (!snapshots.length) return '<div class="empty-msg">No health baselines captured yet.</div>';
    return `<div class="snapshot-list">${snapshots.map(snapshot => `
      <div class="snapshot-card">
        <span><strong>${this.escapeHtml(snapshot.title)}</strong><br>${this.escapeHtml(snapshot.status)} · health ${this.escapeHtml(snapshot.healthScore ?? '—')} · ${this.escapeHtml(snapshot.captured_at || '')}</span>
        ${snapshot.runId ? `<button class="inline-link" data-run-graph="${this.escapeAttribute(snapshot.runId)}">Graph</button>` : '<span>—</span>'}
      </div>
    `).join('')}</div>`;
  },

  renderAddresses(addresses) {
    if (!addresses.length) return '<div class="empty-msg">No host/domain/CIDR/URL targets saved.</div>';
    return `<div class="asset-chip-row">${addresses.map(address => `<span class="asset-chip">${this.escapeHtml(address.kind)}: ${this.escapeHtml(address.value)}</span>`).join('')}</div>`;
  },

  renderEmptyAssets() {
    document.getElementById('asset-main').innerHTML = '<div class="empty-msg">Create an asset to start tracking targets, history, findings, and mitigation state.</div>';
    document.getElementById('asset-inspector').innerHTML = '<div class="inspector-card">Assets are durable operational records. Scopes can reference assets for governed runs.</div>';
  },

  renderAssetEditor(asset = null) {
    const main = document.getElementById('asset-main');
    const inspector = document.getElementById('asset-inspector');
    this.mode = 'assets';
    this.renderAssetList();
    if (inspector) inspector.innerHTML = '<div class="inspector-card">Canonical asset state is saved server-side. Credential references are redacted in API/UI responses.</div>';
    if (!main) return;
    main.innerHTML = `
      <form id="asset-editor" class="asset-form">
        <h2>${asset ? 'Edit asset' : 'New asset'}</h2>
        <div class="form-row">
          <label>Name <input id="asset-name" value="${this.escapeAttribute(asset?.name || '')}" required></label>
          <label>Type <select id="asset-type"><option value="network">Network</option><option value="device">Device</option><option value="web_app">Web app</option><option value="url">URL</option><option value="domain">Domain</option></select></label>
        </div>
        <div class="form-row">
          <label>Owner <input id="asset-owner" value="${this.escapeAttribute(asset?.owner || '')}"></label>
          <label>Environment <input id="asset-environment" value="${this.escapeAttribute(asset?.environment || '')}" placeholder="prod/staging/homelab"></label>
        </div>
        <div class="form-row">
          <label>Criticality <select id="asset-criticality"><option>low</option><option selected>medium</option><option>high</option><option>critical</option></select></label>
          <label>Status <select id="asset-status"><option>active</option><option>degraded</option><option>healthy</option><option>retired</option></select></label>
        </div>
        <label>Addresses <textarea id="asset-addresses" rows="4" placeholder="ip=172.16.24.250\nhost=docker-server.local\ncidr=172.16.24.0/24\nurl=https://app.example.test">${this.escapeHtml(this.addressesToText(asset?.addresses || []))}</textarea></label>
        <label>Services <textarea id="asset-services" rows="4" placeholder="ssh,tcp,22,open,\nhttps,tcp,443,open,https://app.example.test">${this.escapeHtml(this.servicesToText(asset?.services || []))}</textarea></label>
        <label>Tags <input id="asset-tags" value="${this.escapeAttribute((asset?.tags || []).join(', '))}" placeholder="critical, web, staging"></label>
        <label>Credential references <input id="asset-creds" value="" placeholder="vault:path or label only; raw secrets are not allowed"></label>
        <label>Notes <textarea id="asset-notes" rows="4">${this.escapeHtml(asset?.notes || '')}</textarea></label>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Save asset</button><button class="btn btn-secondary" type="button" id="cancel-asset-edit">Cancel</button></div>
      </form>`;
    document.getElementById('asset-type').value = asset?.type || 'device';
    document.getElementById('asset-criticality').value = asset?.criticality || 'medium';
    document.getElementById('asset-status').value = asset?.status || 'active';
    main.querySelector('#asset-editor').addEventListener('submit', (event) => this.saveAsset(event, asset?.id || null));
    main.querySelector('#cancel-asset-edit')?.addEventListener('click', () => this.renderAssetsWorkspace());
  },

  async saveAsset(event, id = null) {
    event.preventDefault();
    const payload = {
      name: document.getElementById('asset-name').value,
      type: document.getElementById('asset-type').value,
      owner: document.getElementById('asset-owner').value,
      environment: document.getElementById('asset-environment').value,
      criticality: document.getElementById('asset-criticality').value,
      status: document.getElementById('asset-status').value,
      addresses: this.parseAddresses(document.getElementById('asset-addresses').value),
      services: this.parseServices(document.getElementById('asset-services').value),
      tags: this.csvValue(document.getElementById('asset-tags').value),
      credentialRefs: this.csvValue(document.getElementById('asset-creds').value),
      notes: document.getElementById('asset-notes').value,
    };
    const res = await fetch(id ? `/api/assets/${encodeURIComponent(id)}` : '/api/assets', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();
    this.selectedAssetId = saved.id;
    await this.loadAll();
  },

  renderSnapshotEditor(asset) {
    const panel = document.getElementById('asset-action-panel');
    if (!panel) return;
    panel.innerHTML = `
      <h3>Add baseline snapshot</h3>
      <label>Title <input id="snapshot-title" value="Manual health baseline"></label>
      <label>Status <select id="snapshot-status"><option>healthy</option><option selected>degraded</option><option>unknown</option></select></label>
      <label>Health score <input id="snapshot-health" type="number" min="0" max="100" value="80"></label>
      <label>Open findings <input id="snapshot-open" type="number" min="0" value="0"></label>
      <label>Observed ports <input id="snapshot-ports" placeholder="22, 80, 443"></label>
      <button class="btn btn-primary btn-sm" id="save-snapshot">Save snapshot</button>`;
    panel.querySelector('#save-snapshot').addEventListener('click', async () => {
      const payload = {
        title: document.getElementById('snapshot-title').value,
        status: document.getElementById('snapshot-status').value,
        healthScore: Number(document.getElementById('snapshot-health').value),
        findingCounts: { open: Number(document.getElementById('snapshot-open').value || 0) },
        observations: { ports: this.csvValue(document.getElementById('snapshot-ports').value).map(Number).filter(Boolean) },
      };
      await this.fetchJSON(`/api/assets/${encodeURIComponent(asset.id)}/snapshots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      await this.selectAsset(asset.id);
    });
  },

  renderFindingEditor(asset) {
    const panel = document.getElementById('asset-action-panel');
    if (!panel) return;
    panel.innerHTML = `
      <h3>Add finding</h3>
      <label>Title <input id="finding-title" placeholder="Finding title"></label>
      <label>Severity <select id="finding-severity"><option>low</option><option selected>medium</option><option>high</option><option>critical</option></select></label>
      <label>Status <select id="finding-status"><option selected>open</option><option>mitigated</option><option>accepted</option><option>false-positive</option></select></label>
      <label>Evidence <textarea id="finding-evidence" rows="3"></textarea></label>
      <label>Recommendation <textarea id="finding-recommendation" rows="3"></textarea></label>
      <button class="btn btn-primary btn-sm" id="save-finding">Save finding</button>`;
    panel.querySelector('#save-finding').addEventListener('click', async () => {
      await this.fetchJSON('/api/findings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        assetId: asset.id,
        title: document.getElementById('finding-title').value || 'Untitled finding',
        severity: document.getElementById('finding-severity').value,
        status: document.getElementById('finding-status').value,
        evidence: document.getElementById('finding-evidence').value,
        recommendation: document.getElementById('finding-recommendation').value,
      }) });
      await this.selectAsset(asset.id);
    });
  },

  renderScopesWorkspace() {
    this.renderScopeList();
    const scope = this.scopes.find(item => item.id === this.selectedScopeId) || this.scopes[0];
    if (scope) this.renderScopeDetail(scope.id);
    else this.renderScopeEditor();
  },

  renderScopeList() {
    const list = document.getElementById('asset-list');
    if (!list) return;
    if (!this.scopes.length) {
      list.innerHTML = '<div class="empty-msg">No scopes yet. Scopes combine assets, raw targets, and risk policy.</div>';
      return;
    }
    list.innerHTML = this.scopes.map(scope => `
      <button class="asset-list-item ${scope.id === this.selectedScopeId ? 'active' : ''}" data-scope-id="${this.escapeAttribute(scope.id)}">
        <span class="asset-type-icon">🎯</span>
        <span class="asset-list-body"><strong>${this.escapeHtml(scope.name)}</strong><small>${this.escapeHtml((scope.raw_targets?.assetIds || []).length)} assets · expires ${this.escapeHtml(scope.expires_at || 'never')}</small></span>
      </button>`).join('');
    list.querySelectorAll('[data-scope-id]').forEach(button => button.addEventListener('click', () => this.renderScopeDetail(button.dataset.scopeId)));
  },

  renderScopeDetail(id) {
    const scope = this.scopes.find(item => item.id === id);
    if (!scope) return this.renderScopeEditor();
    this.selectedScopeId = id;
    this.renderScopeList();
    const selectedAssets = (scope.raw_targets?.assetIds || []).map(assetId => this.assets.find(asset => asset.id === assetId)).filter(Boolean);
    document.getElementById('asset-main').innerHTML = `
      <div class="asset-hero"><div><p class="eyebrow">Governed scope</p><h2>${this.escapeHtml(scope.name)}</h2><p>${this.escapeHtml(scope.notes || 'No ROE notes.')}</p></div><span class="run-pill running">active</span></div>
      <div class="asset-metric-grid"><div><span>Assets</span><strong>${selectedAssets.length}</strong></div><div><span>Hosts</span><strong>${(scope.targets?.hosts || []).length}</strong></div><div><span>Allowed</span><strong>${(scope.allowed_actions || []).join(', ') || 'default'}</strong></div><div><span>Blocked</span><strong>${(scope.blocked_actions || []).join(', ') || '—'}</strong></div></div>
      <section class="inspector-card"><h3>Included assets</h3>${selectedAssets.map(asset => `<span class="asset-chip">${this.iconForAsset(asset.type)} ${this.escapeHtml(asset.name)}</span>`).join('') || '<div class="empty-msg">Raw-target-only scope.</div>'}</section>
      <section class="inspector-card"><h3>Expanded targets</h3>${this.renderTargetSummary(scope.targets || {})}</section>`;
    document.getElementById('asset-inspector').innerHTML = `<div class="inspector-card"><h3>Scope actions</h3><div class="inspector-actions"><button class="btn btn-secondary btn-sm" id="use-scope-btn">Use for chat</button><button class="btn btn-secondary btn-sm" id="edit-scope-btn">Edit scope</button></div></div>`;
    document.getElementById('use-scope-btn')?.addEventListener('click', () => { const select = document.getElementById('active-scope-select'); if (select) select.value = scope.id; });
    document.getElementById('edit-scope-btn')?.addEventListener('click', () => this.renderScopeEditor(scope));
  },

  renderScopeEditor(scope = null, preselectedAssetIds = []) {
    this.mode = 'scopes';
    document.querySelectorAll('[data-asset-mode]').forEach(button => button.classList.toggle('active', button.dataset.assetMode === 'scopes'));
    const raw = scope?.raw_targets || scope?.targets || {};
    const selected = new Set([...(raw.assetIds || []), ...preselectedAssetIds]);
    document.getElementById('asset-main').innerHTML = `
      <form id="scope-editor" class="asset-form">
        <h2>${scope ? 'Edit scope' : 'New scope'}</h2>
        <label>Name <input id="scope-name" value="${this.escapeAttribute(scope?.name || '')}" required></label>
        <div class="asset-selector-grid">${this.assets.map(asset => `<label class="asset-checkbox"><input type="checkbox" value="${this.escapeAttribute(asset.id)}" ${selected.has(asset.id) ? 'checked' : ''}>${this.iconForAsset(asset.type)} ${this.escapeHtml(asset.name)}<small>${this.escapeHtml(asset.environment || asset.type)}</small></label>`).join('') || '<div class="empty-msg">Create assets first or enter raw targets below.</div>'}</div>
        <label>Raw hosts <input id="scope-hosts" value="${this.escapeAttribute((raw.hosts || []).join(', '))}"></label>
        <label>Raw domains <input id="scope-domains" value="${this.escapeAttribute((raw.domains || []).join(', '))}"></label>
        <label>Raw CIDRs <input id="scope-cidrs" value="${this.escapeAttribute((raw.cidrs || []).join(', '))}"></label>
        <label>Raw URLs <input id="scope-urls" value="${this.escapeAttribute((raw.urls || []).join(', '))}"></label>
        <div class="form-row"><label>Allowed risks <input id="scope-allowed" value="${this.escapeAttribute((scope?.allowed_actions || []).join(', '))}" placeholder="recon, network-scan"></label><label>Blocked risks <input id="scope-blocked" value="${this.escapeAttribute((scope?.blocked_actions || []).join(', '))}" placeholder="exploit, destructive"></label></div>
        <label>Expires <input id="scope-expires" placeholder="ISO timestamp" value="${this.escapeAttribute(scope?.expires_at || '')}"></label>
        <label>ROE notes <textarea id="scope-notes" rows="4">${this.escapeHtml(scope?.notes || '')}</textarea></label>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Save scope</button></div>
      </form>`;
    document.getElementById('asset-inspector').innerHTML = '<div class="inspector-card">Scopes reference assets plus raw target strings. Risky tools are still checked at execution time.</div>';
    document.getElementById('scope-editor').addEventListener('submit', (event) => this.saveScope(event, scope?.id || null));
  },

  async saveScope(event, id = null) {
    event.preventDefault();
    const assetIds = Array.from(document.querySelectorAll('.asset-checkbox input:checked')).map(input => input.value);
    const payload = {
      name: document.getElementById('scope-name').value,
      targets: {
        assetIds,
        hosts: this.csv('scope-hosts'),
        domains: this.csv('scope-domains'),
        cidrs: this.csv('scope-cidrs'),
        urls: this.csv('scope-urls'),
      },
      allowedActions: this.csv('scope-allowed'),
      blockedActions: this.csv('scope-blocked'),
      expiresAt: document.getElementById('scope-expires').value || null,
      notes: document.getElementById('scope-notes').value,
    };
    const res = await fetch(id ? `/api/scopes/${encodeURIComponent(id)}` : '/api/scopes', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();
    this.selectedScopeId = saved.id;
    await this.loadAll();
    this.setMode('scopes');
  },

  renderCompareWorkspace() {
    const list = document.getElementById('asset-list');
    if (list) list.innerHTML = this.comparisons.length ? this.comparisons.map(comp => `<button class="asset-list-item"><span class="asset-type-icon">⇄</span><span class="asset-list-body"><strong>${this.escapeHtml(comp.title)}</strong><small>${this.escapeHtml(comp.summary)}</small></span></button>`).join('') : '<div class="empty-msg">No comparisons yet. Create snapshots from an asset, then compare.</div>';
    const snapshots = this.assets.flatMap(asset => (asset.snapshots || []).map(s => ({ ...s, assetName: asset.name })));
    document.getElementById('asset-main').innerHTML = `
      <div class="asset-hero"><div><p class="eyebrow">Mitigation verification</p><h2>Before / after comparison</h2><p>Compare baseline snapshots to verify what changed after mitigation.</p></div></div>
      <form id="compare-form" class="asset-form compact-form">
        <label>Before <select id="compare-before">${snapshots.map(s => `<option value="${this.escapeAttribute(s.id)}">${this.escapeHtml(s.assetName)} · ${this.escapeHtml(s.title)} · ${this.escapeHtml(s.healthScore ?? '—')}</option>`).join('')}</select></label>
        <label>After <select id="compare-after">${snapshots.map(s => `<option value="${this.escapeAttribute(s.id)}">${this.escapeHtml(s.assetName)} · ${this.escapeHtml(s.title)} · ${this.escapeHtml(s.healthScore ?? '—')}</option>`).join('')}</select></label>
        <button class="btn btn-primary" ${snapshots.length < 2 ? 'disabled' : ''}>Compare snapshots</button>
      </form>
      <div class="comparison-grid">${this.comparisons.map(c => this.renderComparisonCard(c)).join('') || '<div class="empty-msg">Comparison results will appear here.</div>'}</div>`;
    document.getElementById('asset-inspector').innerHTML = '<div class="inspector-card">Use rerun templates from Runs/API to produce after-mitigation checks, then compare snapshots here.</div>';
    document.getElementById('compare-form')?.addEventListener('submit', event => this.saveComparison(event));
  },

  async saveComparison(event) {
    event.preventDefault();
    const baseSnapshotId = document.getElementById('compare-before').value;
    const compareSnapshotId = document.getElementById('compare-after').value;
    if (!baseSnapshotId || !compareSnapshotId || baseSnapshotId === compareSnapshotId) return;
    await this.fetchJSON('/api/comparisons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseSnapshotId, compareSnapshotId, title: 'Mitigation comparison' }) });
    await this.loadAll();
    this.setMode('compare');
  },

  renderComparisonCard(c) {
    return `<article class="comparison-card"><strong>${this.escapeHtml(c.title)}</strong><p>${this.escapeHtml(c.summary)}</p><div class="asset-chip-row"><span class="asset-chip">Health ${this.escapeHtml(c.diff?.healthDelta ?? 0)}</span><span class="asset-chip">Resolved ${this.escapeHtml(c.diff?.resolvedFindings ?? 0)}</span><span class="asset-chip">Added ${this.escapeHtml(c.diff?.addedFindings ?? 0)}</span></div></article>`;
  },

  renderTargetSummary(targets) {
    return ['hosts', 'domains', 'cidrs', 'urls'].map(key => `<div class="target-row"><span>${key}</span><strong>${this.escapeHtml((targets[key] || []).join(', ') || '—')}</strong></div>`).join('');
  },

  parseAddresses(text) {
    return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [kind, ...rest] = line.includes('=') ? line.split('=') : ['host', line];
      return { kind: kind.trim(), value: rest.join('=').trim() };
    });
  },

  addressesToText(addresses) { return addresses.map(a => `${a.kind}=${a.value}`).join('\n'); },
  servicesToText(services) { return services.map(s => [s.name, s.protocol, s.port, s.status, s.url].filter(v => v !== undefined && v !== null).join(',')).join('\n'); },
  parseServices(text) {
    return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [name, protocol, port, status, url] = line.split(',').map(item => item.trim());
      return { name, protocol: protocol || 'tcp', port: port ? Number(port) : null, status: status || 'unknown', url: url || null };
    });
  },
  csv(id) { return this.csvValue(document.getElementById(id)?.value || ''); },
  csvValue(value) { return String(value || '').split(',').map(s => s.trim()).filter(Boolean); },
  iconForAsset(type) { return { network: '🌐', device: '🖥️', web_app: '🧭', url: '🔗', domain: '🏷️' }[type] || '📍'; },
  healthClass(status) { return ['healthy', 'active', 'open'].includes(status) ? 'healthy' : ['degraded', 'failed'].includes(status) ? 'degraded' : 'unknown'; },
  async fetchJSON(url, options) { const res = await fetch(url, options); if (!res.ok) throw new Error(`HTTP ${res.status}`); return await res.json(); },
  escapeHtml(value) { const div = document.createElement('div'); div.textContent = value == null ? '' : String(value); return div.innerHTML; },
  escapeAttribute(value) { return this.escapeHtml(value).replace(/"/g, '&quot;'); },
};
