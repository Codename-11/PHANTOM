window.ScopePage = {
  assets: [],
  scopes: [],
  comparisons: [],
  scopeTemplates: [],
  roeTemplates: [],
  toolpacks: [],
  selectedAssetId: null,
  selectedScopeId: null,
  selectedTemplateId: null,
  selectedToolpackIds: new Set(),
  // Draft scope state for the new policy fields. The action_modes map is
  // canonical — allowed/blocked CSV inputs are derived from it for backwards
  // compat with the policy evaluator's legacy reads.
  draftActionModes: null,
  draftActiveHours: null,
  draftBlackoutWindows: null,
  draftRateCaps: null,
  draftRoeText: '',
  mode: 'scopes',
  assetFilter: { query: '', type: '' },
  _scopeBoundOnce: false,

  init() {
    document.getElementById('refresh-scopes-btn')?.addEventListener('click', () => this.loadAll());
    document.getElementById('new-asset-btn')?.addEventListener('click', () => { this.setMode('assets'); this.renderAssetEditor(); });
    document.getElementById('new-scope-btn')?.addEventListener('click', () => { this.setMode('scopes'); this.renderScopeEditor(); });
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
    this.bindScopeBuilderOnce();
    this.loadScopesForSelector();
    if (window.Router?.current === 'scope') setTimeout(() => this.loadAll(), 0);
    if (typeof bindAssetDrawerOnce === 'function') bindAssetDrawerOnce();
  },

  bindScopeBuilderOnce() {
    if (this._scopeBoundOnce) return;
    this._scopeBoundOnce = true;
    // Target parsing on blur or paste
    const ta = document.getElementById('scope-target-input');
    if (ta) {
      ta.addEventListener('blur', () => this.parseTargetInput());
      ta.addEventListener('paste', () => setTimeout(() => this.parseTargetInput(), 0));
    }
    // Action-class table delegated change handler
    const tbl = document.getElementById('scope-action-table');
    tbl?.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.dataset.actionAllow || t.dataset.actionDeny || t.dataset.actionModeInput) {
        this.syncActionClassHiddenInputs();
      }
    });
    // Chip removal
    const chips = document.getElementById('scope-target-chips');
    chips?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-target]');
      if (!btn) return;
      const id = btn.dataset.removeTarget;
      const chip = btn.closest('.target-chip');
      if (chip) chip.remove();
      this.updateTargetCount();
    });
    // Intent tile delegated click
    document.getElementById('scope-intent-grid')?.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-template-id]');
      if (!tile) return;
      this.applyScopeTemplate(tile.dataset.templateId);
    });
    // ROE template select handler
    document.getElementById('scope-roe-template')?.addEventListener('change', (e) => {
      if (e.target.value) this.applyRoeTemplate(e.target.value);
    });
    // ROE textarea live-sync into draftRoeText
    document.getElementById('scope-roe')?.addEventListener('input', (e) => {
      this.draftRoeText = e.target.value;
    });
    // Toolpack card delegated click
    document.getElementById('scope-toolpack-grid')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-toolpack-id]');
      if (!card) return;
      const id = card.dataset.toolpackId;
      if (this.selectedToolpackIds.has(id)) this.selectedToolpackIds.delete(id);
      else this.selectedToolpackIds.add(id);
      card.classList.toggle('selected', this.selectedToolpackIds.has(id));
    });
    // Action buttons
    document.getElementById('scope-save-btn')?.addEventListener('click', (e) => this.saveScopeFromBuilder(e));
    document.getElementById('scope-dryrun-btn')?.addEventListener('click', () => this.previewScopePolicy());
    document.getElementById('scope-policy-refresh')?.addEventListener('click', () => this.previewScopePolicy());
    document.getElementById('scope-cancel-btn')?.addEventListener('click', () => this.resetScopeBuilder());
    document.getElementById('scope-archive-btn')?.addEventListener('click', () => this.archiveCurrentScope());
  },

  async loadAll() {
    await Promise.all([
      this.loadAssets(false),
      this.loadScopes(false),
      this.loadComparisons(false),
      this.loadScopeTemplates(),
      this.loadRoeTemplates(),
      this.loadToolpacks(),
    ]);
    await this.loadAssetOperationalDetails();
    this.renderCurrentMode();
    this.renderActiveSelector();
    if (this.mode === 'scopes') this.renderScopeBuilderShell();
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

  async loadScopeTemplates() {
    const res = await fetch('/api/scopes/templates');
    this.scopeTemplates = res.ok ? await res.json() : [];
  },

  async loadToolpacks() {
    const res = await fetch('/api/toolpacks');
    this.toolpacks = res.ok ? await res.json() : [];
  },

  async loadScopesForSelector() {
    try {
      await Promise.all([this.loadScopes(false), this.loadToolpacks(), this.loadScopeTemplates()]);
      this.renderActiveSelector();
      if (this.mode === 'scopes') this.renderScopeBuilderShell();
    } catch {}
  },

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('[data-asset-mode]').forEach(button => button.classList.toggle('active', button.dataset.assetMode === mode));
    // Show only the active mode panel
    document.getElementById('scope-mode-panel')?.classList.toggle('hidden', mode !== 'scopes');
    document.getElementById('assets-mode-panel')?.classList.toggle('hidden', mode !== 'assets');
    document.getElementById('compare-mode-panel')?.classList.toggle('hidden', mode !== 'compare');
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
    select.onchange = () => this.renderActiveScopeSummary();
    this.renderActiveScopeSummary();
    this.renderToolpackSelector();
  },

  renderActiveScopeSummary() {
    const summary = document.getElementById('active-scope-summary');
    const select = document.getElementById('active-scope-select');
    if (!summary || !select) return;
    const scope = this.scopes.find(item => item.id === select.value);
    if (!scope) { summary.textContent = 'No active scope'; return; }
    const allowed = (scope.allowed_actions || []).join(', ') || 'default policy';
    summary.textContent = `${scope.name} · ${(scope.targets?.hosts || []).length} hosts · allowed: ${allowed}`;
  },

  renderToolpackSelector() {
    const select = document.getElementById('active-toolpack-select');
    if (!select) return;
    const selected = new Set(Array.from(select.selectedOptions || []).map(option => option.value));
    select.innerHTML = this.toolpacks.map(pack => `<option value="${this.escapeAttribute(pack.id)}" ${selected.has(pack.id) ? 'selected' : ''}>${this.escapeHtml(pack.name)}</option>`).join('');
  },

  // ─── Scopes mode (2-col kit builder) ───
  renderScopesWorkspace() {
    this.renderScopeBuilderShell();
  },

  renderScopeBuilderShell() {
    this.renderIntentTiles();
    this.renderActionClassTable();
    this.renderToolpackGrid();
    this.renderAssetPicker();
    // initialise hidden inputs from current table state
    this.syncActionClassHiddenInputs();
    this.updateTargetCount();
    // Initialise drawer with idle preview
    this.renderPolicyDrawer(null);
  },

  renderIntentTiles() {
    const grid = document.getElementById('scope-intent-grid');
    if (!grid) return;
    if (!this.scopeTemplates.length) {
      grid.innerHTML = '<div class="empty-msg">Loading intent templates…</div>';
      return;
    }
    grid.innerHTML = this.scopeTemplates.map(template => {
      const risk = this.templateRisk(template);
      const active = template.id === this.selectedTemplateId ? 'active' : '';
      return `<button type="button" class="intent-tile ${active}" data-template-id="${this.escapeAttribute(template.id)}">`
        + `<span class="risk ${this.escapeAttribute(risk)}">${this.escapeHtml(risk)}</span>`
        + `<span class="name">${this.escapeHtml(template.name)}</span>`
        + `<span class="desc">${this.escapeHtml(template.summary || '')}</span>`
        + `</button>`;
    }).join('');
  },

  templateRisk(template) {
    const blocked = (template.blockedActions || []).join(',');
    if (/destructive|exploit/.test(blocked) && (template.allowedActions || []).some(a => /credential|brute/.test(a))) return 'high';
    if ((template.allowedActions || []).some(a => /network-scan|web-vuln|credentialed|exploit/.test(a))) return 'med';
    if (!template.allowedActions || !template.allowedActions.length) return 'info';
    return 'low';
  },

  renderActionClassTable() {
    const tbl = document.getElementById('scope-action-table');
    if (!tbl) return;
    const tbody = tbl.querySelector('tbody');
    if (!tbody) return;
    const allowed = this.csv('scope-allowed');
    const blocked = this.csv('scope-blocked');
    // Pass action_modes when set so the builder renders the 3-state matrix
    // with the right radios pre-selected. When unset, the builder falls back
    // to interpreting allowed/blocked as auto/deny respectively.
    tbody.innerHTML = window.ScopeBuilder?.renderActionClassTable({
      allowed, blocked, action_modes: this.draftActionModes,
    }) || '';
  },

  renderToolpackGrid() {
    const grid = document.getElementById('scope-toolpack-grid');
    if (!grid) return;
    if (!this.toolpacks.length) {
      grid.innerHTML = '<div class="empty-msg">No toolpacks available.</div>';
      return;
    }
    grid.innerHTML = this.toolpacks.map(pack => {
      const selected = this.selectedToolpackIds.has(pack.id) ? 'selected' : '';
      return `<button type="button" class="toolpack-card ${selected}" data-toolpack-id="${this.escapeAttribute(pack.id)}">`
        + `<span class="name">${this.escapeHtml(pack.name)}</span>`
        + `<span class="desc">${this.escapeHtml(pack.summary || pack.tools || '')}</span>`
        + `</button>`;
    }).join('');
  },

  renderAssetPicker() {
    const select = document.getElementById('scope-asset-select');
    if (!select) return;
    const selected = new Set(Array.from(select.selectedOptions || []).map(o => o.value));
    select.innerHTML = this.assets.map(asset => `<option value="${this.escapeAttribute(asset.id)}" ${selected.has(asset.id) ? 'selected' : ''}>${this.escapeHtml(asset.name)} · ${this.escapeHtml(asset.type)}</option>`).join('');
  },

  syncActionClassHiddenInputs() {
    // Read the canonical 3-state matrix first; derive legacy allowed/blocked
    // CSV inputs from it so older code paths keep working.
    if (window.ScopeBuilder?.readActionModes) {
      const modes = window.ScopeBuilder.readActionModes(document);
      if (Object.keys(modes).length) {
        this.draftActionModes = modes;
        const allowed = Object.entries(modes).filter(([, v]) => v === 'auto').map(([k]) => k);
        const blocked = Object.entries(modes).filter(([, v]) => v === 'deny').map(([k]) => k);
        const allowEl = document.getElementById('scope-allowed');
        const blockEl = document.getElementById('scope-blocked');
        if (allowEl) allowEl.value = allowed.join(', ');
        if (blockEl) blockEl.value = blocked.join(', ');
        return;
      }
    }
    // Fallback path — hidden legacy checkboxes (kept for backwards compat).
    const allowedEls = document.querySelectorAll('#scope-action-table input[data-action-allow]:checked');
    const deniedEls = document.querySelectorAll('#scope-action-table input[data-action-deny]:checked');
    const allowed = Array.from(allowedEls).map(el => el.dataset.actionAllow);
    const blocked = Array.from(deniedEls).map(el => el.dataset.actionDeny);
    const allowEl = document.getElementById('scope-allowed');
    const blockEl = document.getElementById('scope-blocked');
    if (allowEl) allowEl.value = allowed.join(', ');
    if (blockEl) blockEl.value = blocked.join(', ');
  },

  updateTargetCount() {
    const chips = document.querySelectorAll('#scope-target-chips .target-chip');
    const lbl = document.getElementById('scope-target-count');
    if (lbl) lbl.textContent = `${chips.length} ITEM${chips.length === 1 ? '' : 'S'}`;
  },

  async parseTargetInput() {
    const ta = document.getElementById('scope-target-input');
    const chipsEl = document.getElementById('scope-target-chips');
    if (!ta || !chipsEl) return;
    const input = ta.value.trim();
    if (!input) return;
    try {
      const parsed = await this.fetchJSON('/api/scopes/parse-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const targets = parsed.targets || parsed.scopeFields || parsed;
      chipsEl.innerHTML = window.ScopeBuilder?.renderTargetChips(targets) || '';
      this.updateTargetCount();
    } catch (err) {
      chipsEl.innerHTML = `<span class="caption" style="color:var(--sev-crit);">Parse failed: ${this.escapeHtml(err.message)}</span>`;
    }
  },

  applyScopeTemplate(id) {
    const template = this.scopeTemplates.find(item => item.id === id);
    if (!template) return;
    this.selectedTemplateId = id;
    document.querySelectorAll('#scope-intent-grid .intent-tile').forEach(el => {
      el.classList.toggle('active', el.dataset.templateId === id);
    });
    const draft = window.ScopeBuilder?.templateToDraft(template) || template;
    const name = document.getElementById('scope-name');
    if (name && !name.value) name.value = String(draft.nameSuffix || template.name).toUpperCase().replace(/\s+/g, '-');
    const allowEl = document.getElementById('scope-allowed');
    const blockEl = document.getElementById('scope-blocked');
    if (allowEl) allowEl.value = (draft.allowedActions || []).join(', ');
    if (blockEl) blockEl.value = (draft.blockedActions || []).join(', ');
    const notes = document.getElementById('scope-notes');
    if (notes && !notes.value) notes.value = draft.notes || '';
    // Apply toolpacks
    this.selectedToolpackIds = new Set(draft.toolpackIds || []);
    this.renderToolpackGrid();
    // Re-render the action class table to reflect new allow/deny state
    this.renderActionClassTable();
  },

  collectTargetChips() {
    const chipEls = document.querySelectorAll('#scope-target-chips .target-chip');
    const fields = { hosts: [], domains: [], cidrs: [], urls: [], assetIds: [] };
    chipEls.forEach(el => {
      const kind = el.dataset.kind || 'host';
      const value = el.dataset.value || '';
      if (!value) return;
      if (kind === 'url') fields.urls.push(value);
      else if (kind === 'domain') fields.domains.push(value);
      else if (kind === 'cidr') fields.cidrs.push(value);
      else if (kind === 'asset') fields.assetIds.push(value);
      else fields.hosts.push(value);
    });
    // Also collect any selected asset rows from the picker
    const picker = document.getElementById('scope-asset-select');
    if (picker) Array.from(picker.selectedOptions || []).forEach(o => fields.assetIds.push(o.value));
    return fields;
  },

  scopePayloadFromBuilder() {
    const targets = this.collectTargetChips();
    targets.toolpackIds = Array.from(this.selectedToolpackIds);
    // Ensure draftActionModes is current with the visible radios.
    if (window.ScopeBuilder?.readActionModes) {
      const modes = window.ScopeBuilder.readActionModes(document);
      if (Object.keys(modes).length) this.draftActionModes = modes;
    }
    const roeEl = document.getElementById('scope-roe');
    return {
      name: document.getElementById('scope-name')?.value || '',
      targets,
      allowedActions: this.csv('scope-allowed'),
      blockedActions: this.csv('scope-blocked'),
      actionModes: this.draftActionModes || null,
      activeHours: this.draftActiveHours || null,
      blackoutWindows: this.draftBlackoutWindows || null,
      rateCaps: this.draftRateCaps || null,
      rulesOfEngagement: (roeEl && roeEl.value) || this.draftRoeText || '',
      expiresAt: document.getElementById('scope-expires')?.value || null,
      owner: document.getElementById('scope-owner')?.value || null,
      notes: document.getElementById('scope-notes')?.value || '',
    };
  },

  async previewScopePolicy() {
    const scope = this.scopePayloadFromBuilder();
    // Build sample commands from a few targets
    const sampleTargets = [
      ...(scope.targets.hosts || []).slice(0, 2),
      ...(scope.targets.domains || []).slice(0, 2),
      ...(scope.targets.urls || []).slice(0, 1),
    ];
    const samples = sampleTargets.length ? sampleTargets : ['example.local'];
    try {
      const decisions = await Promise.all(samples.map(async (t) => {
        try {
          const decision = await this.fetchJSON('/api/scopes/evaluate-draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toolName: 'execute_command',
              args: { command: `curl -sS ${t}` },
              scope,
            }),
          });
          return { ...decision, target: t };
        } catch (err) {
          return { allowed: false, reason: err.message, target: t, risk: 'unknown' };
        }
      }));
      const allowed = decisions.filter(d => d.allowed).length;
      const blocked = decisions.length - allowed;
      const decision = { allowed, blocked, samples: decisions.map(d => ({
        allowed: d.allowed, risk: d.risk, target: d.target, reason: d.reason,
      })) };
      this.renderPolicyDrawer(decision, scope);
    } catch (err) {
      this.renderPolicyDrawer({ allowed: false, reason: err.message, risk: 'unknown', targets: [] }, scope);
    }
  },

  renderPolicyDrawer(decision, scope = null) {
    const body = document.getElementById('scope-policy-preview');
    const title = document.getElementById('scope-policy-title');
    const sub = document.getElementById('scope-policy-sub');
    const stamp = document.getElementById('scope-policy-stamp');
    if (body) body.innerHTML = window.ScopeBuilder?.renderPolicyPreview(decision) || '';
    if (decision == null) {
      if (title) title.textContent = scope?.name || 'No scope yet';
      if (sub) sub.textContent = 'Build a scope on the left, then dry-run.';
      if (stamp) stamp.textContent = '—';
      return;
    }
    if (typeof decision.allowed === 'number') {
      if (title) title.textContent = scope?.name || 'Dry-run preview';
      if (sub) sub.textContent = `Allowed: ${decision.allowed} · Blocked: ${decision.blocked}`;
    } else {
      if (title) title.textContent = scope?.name || (decision.allowed ? 'Allowed' : 'Blocked');
      if (sub) sub.textContent = decision.reason || '';
    }
    if (stamp) stamp.textContent = new Date().toLocaleTimeString();
  },

  async saveScopeFromBuilder(event) {
    if (event) event.preventDefault();
    const payload = this.scopePayloadFromBuilder();
    if (!payload.name) {
      alert('Scope name is required.');
      return;
    }
    const id = this.selectedScopeId;
    try {
      const res = await fetch(id ? `/api/scopes/${encodeURIComponent(id)}` : '/api/scopes', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      this.selectedScopeId = saved.id;
      await this.loadAll();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  },

  resetScopeBuilder() {
    this.selectedScopeId = null;
    this.selectedTemplateId = null;
    this.selectedToolpackIds = new Set();
    this.draftActionModes = null;
    this.draftActiveHours = null;
    this.draftBlackoutWindows = null;
    this.draftRateCaps = null;
    this.draftRoeText = '';
    ['scope-name', 'scope-expires', 'scope-owner', 'scope-notes', 'scope-target-input', 'scope-roe'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const chips = document.getElementById('scope-target-chips');
    if (chips) chips.innerHTML = '';
    const allow = document.getElementById('scope-allowed');
    const block = document.getElementById('scope-blocked');
    if (allow) allow.value = '';
    if (block) block.value = '';
    this.renderScopeBuilderShell();
  },

  // ROE templates — pre-built scope payloads from /api/scopes/roe-templates.
  // Operators pick one to seed action_modes + windows + caps + ROE text;
  // the rest of the builder (name, targets, toolpacks) is independent.
  async loadRoeTemplates() {
    try {
      const res = await this.fetchJSON('/api/scopes/roe-templates');
      this.roeTemplates = Array.isArray(res?.templates) ? res.templates : [];
      this.renderRoeTemplateSelect();
    } catch (err) {
      console.warn('Failed to load ROE templates:', err.message);
    }
  },

  renderRoeTemplateSelect() {
    const sel = document.getElementById('scope-roe-template');
    if (!sel) return;
    sel.innerHTML = '<option value="">No ROE template…</option>'
      + this.roeTemplates.map((t) => `<option value="${this.escapeAttribute(t.id)}">${this.escapeHtml(t.name)}</option>`).join('');
  },

  applyRoeTemplate(id) {
    const tpl = this.roeTemplates.find((t) => t.id === id);
    if (!tpl) return;
    const p = tpl.payload || {};
    if (p.action_modes) this.draftActionModes = { ...p.action_modes };
    if (p.active_hours) this.draftActiveHours = { ...p.active_hours };
    if (p.blackout_windows) this.draftBlackoutWindows = { ...p.blackout_windows };
    if (p.rate_caps) this.draftRateCaps = { ...p.rate_caps };
    if (p.rules_of_engagement) {
      this.draftRoeText = p.rules_of_engagement;
      const roeEl = document.getElementById('scope-roe');
      if (roeEl) roeEl.value = this.draftRoeText;
    }
    // Update small summary chips so the operator sees what was applied.
    const hint = document.getElementById('scope-roe-template-hint');
    if (hint) {
      const bits = [];
      if (p.action_modes) bits.push(`${Object.keys(p.action_modes).length} action modes`);
      if (p.active_hours) bits.push('active hours');
      if (p.rate_caps) bits.push('rate caps');
      hint.textContent = bits.length ? `Applied · ${bits.join(' · ')}` : '';
    }
    this.renderActionClassTable();
    this.syncActionClassHiddenInputs();
  },

  async archiveCurrentScope() {
    const id = this.selectedScopeId;
    if (!id) { alert('Select a saved scope to archive.'); return; }
    if (!confirm('Archive this scope?')) return;
    try {
      const res = await fetch(`/api/scopes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.resetScopeBuilder();
      await this.loadAll();
    } catch (err) {
      alert(`Archive failed: ${err.message}`);
    }
  },

  // ─── Editor entry points kept for compatibility ───
  renderScopeEditor() {
    this.setMode('scopes');
    this.resetScopeBuilder();
  },

  renderScopeDetail(id) {
    const scope = this.scopes.find(item => item.id === id);
    if (!scope) return this.renderScopeEditor();
    this.selectedScopeId = id;
    // Hydrate the builder form with the selected scope
    const raw = scope.raw_targets || scope.targets || {};
    document.getElementById('scope-name').value = scope.name || '';
    document.getElementById('scope-expires').value = scope.expires_at || '';
    document.getElementById('scope-owner').value = scope.owner || '';
    document.getElementById('scope-notes').value = scope.notes || '';
    document.getElementById('scope-allowed').value = (scope.allowed_actions || []).join(', ');
    document.getElementById('scope-blocked').value = (scope.blocked_actions || []).join(', ');
    // New policy fields
    this.draftActionModes = scope.action_modes || null;
    this.draftActiveHours = scope.active_hours || null;
    this.draftBlackoutWindows = scope.blackout_windows || null;
    this.draftRateCaps = scope.rate_caps || null;
    this.draftRoeText = scope.rules_of_engagement || '';
    const roeEl = document.getElementById('scope-roe');
    if (roeEl) roeEl.value = this.draftRoeText;
    this.selectedToolpackIds = new Set(raw.toolpackIds || []);
    // Hydrate target chips
    const chips = document.getElementById('scope-target-chips');
    const flatTargets = [
      ...(raw.urls || []).map(v => ({ kind: 'url', value: v })),
      ...(raw.domains || []).map(v => ({ kind: 'domain', value: v })),
      ...(raw.hosts || []).map(v => ({ kind: 'host', value: v })),
      ...(raw.cidrs || []).map(v => ({ kind: 'cidr', value: v })),
      ...(raw.assetIds || []).map(v => ({ kind: 'asset', value: v })),
    ];
    if (chips) chips.innerHTML = window.ScopeBuilder?.renderTargetChips(flatTargets) || '';
    this.renderScopeBuilderShell();
    this.updateTargetCount();
  },

  // ─── Assets mode (untouched in this pass) ───
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
      list.innerHTML = `
        <div class="scan-empty">
          <p class="scan-empty-lede">No assets yet.</p>
          <p class="scan-empty-sub">Create a target manually, or let PHANTOM read this machine's ARP table to seed drafts.</p>
          <button class="btn btn-primary btn-sm" data-action="scan-local-network">Scan this machine's network</button>
        </div>`;
      list.querySelector('[data-action="scan-local-network"]')?.addEventListener('click', () => this.openScanModal());
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
    document.querySelector('[data-action="scope-from-asset"]')?.addEventListener('click', () => { this.setMode('scopes'); this.resetScopeBuilder(); this.selectedToolpackIds = new Set(); });
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
    const main = document.getElementById('asset-main');
    const inspector = document.getElementById('asset-inspector');
    if (main) {
      main.innerHTML = `
        <div class="scan-empty-main">
          <p class="eyebrow">Inventory empty</p>
          <h2>No assets yet</h2>
          <p>Create a target manually, or read this machine's ARP / neighbor table to propose drafts.</p>
          <div class="scan-empty-actions">
            <button class="btn btn-primary" data-action="scan-local-network">Scan this machine's network</button>
            <button class="btn btn-secondary" id="empty-state-new-asset">Add asset manually</button>
          </div>
          <p class="scan-empty-hint">The scan is passive — PHANTOM only reads entries the kernel already learned from local traffic. No probes are sent.</p>
        </div>`;
      main.querySelector('[data-action="scan-local-network"]')?.addEventListener('click', () => this.openScanModal());
      main.querySelector('#empty-state-new-asset')?.addEventListener('click', () => this.renderAssetEditor());
    }
    if (inspector) inspector.innerHTML = '<div class="inspector-card">Assets are durable operational records. Scopes can reference assets for governed runs.</div>';
  },

  // ── Local-network scan modal (A1b) ────────────────────────────────────
  //
  // Two-stage flow:
  //   1. Acknowledgement modal (only when no active scope is selected)
  //      — operator confirms that the scan is OK to run.
  //   2. Review modal — discovered hosts listed with checkboxes. Operator
  //      selects which ones to promote to draft assets.
  //
  // The acknowledgement DOM lives in #scan-ack-modal; review DOM lives in
  // #scan-review-modal (both in index.html). Both share the .scan-modal
  // base class (kit-aligned tokens — see frontend/css/styles.css).
  async openScanModal() {
    const scopeId = document.getElementById('active-scope-select')?.value || '';
    if (!scopeId) {
      this.openScanAckModal();
      return;
    }
    await this.runScan({ scopeId });
  },

  openScanAckModal() {
    const modal = document.getElementById('scan-ack-modal');
    if (!modal) {
      // Fallback when markup is missing — proceed with built-in confirm.
      if (window.confirm('No scope is active. ARP / neighbor reads can be visible to network monitoring. Continue?')) {
        this.runScan({ scopeId: '', acknowledgedNoScope: true });
      }
      return;
    }
    modal.classList.remove('hidden');
    modal.removeAttribute('hidden');
    const close = () => { modal.classList.add('hidden'); modal.setAttribute('hidden', ''); };
    const confirmBtn = document.getElementById('scan-ack-confirm');
    const cancelBtn = document.getElementById('scan-ack-cancel');
    const closeBtn = modal.querySelector('[data-scan-close]');
    const backdrop = modal.querySelector('.scan-backdrop');
    const onConfirm = () => { close(); this.runScan({ scopeId: '', acknowledgedNoScope: true }); };
    const onCancel = () => { close(); };
    // Re-bind defensively (modal can be re-opened multiple times).
    confirmBtn?.replaceWith(confirmBtn.cloneNode(true));
    cancelBtn?.replaceWith(cancelBtn.cloneNode(true));
    closeBtn?.replaceWith(closeBtn.cloneNode(true));
    document.getElementById('scan-ack-confirm')?.addEventListener('click', onConfirm);
    document.getElementById('scan-ack-cancel')?.addEventListener('click', onCancel);
    modal.querySelector('[data-scan-close]')?.addEventListener('click', onCancel);
    backdrop?.addEventListener('click', onCancel, { once: true });
  },

  async runScan({ scopeId = '', acknowledgedNoScope = false } = {}) {
    try {
      const res = await fetch('/api/discover/local-network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeId: scopeId || null, acknowledgedNoScope }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.showScanError(body?.error || `Scan failed (HTTP ${res.status})`);
        return;
      }
      this.openScanReviewModal(body);
    } catch (err) {
      this.showScanError(err.message || 'Scan failed');
    }
  },

  showScanError(message) {
    const modal = document.getElementById('scan-review-modal');
    if (!modal) { window.alert(message); return; }
    modal.classList.remove('hidden');
    modal.removeAttribute('hidden');
    const body = document.getElementById('scan-review-body');
    if (body) body.innerHTML = `<div class="empty-msg danger">${this.escapeHtml(message)}</div>`;
    const closeBtn = modal.querySelector('[data-scan-close]');
    closeBtn?.addEventListener('click', () => { modal.classList.add('hidden'); modal.setAttribute('hidden', ''); }, { once: true });
  },

  openScanReviewModal(result) {
    const modal = document.getElementById('scan-review-modal');
    if (!modal) { window.alert(`Found ${result.count} neighbors`); return; }
    modal.classList.remove('hidden');
    modal.removeAttribute('hidden');
    const body = document.getElementById('scan-review-body');
    const meta = document.getElementById('scan-review-meta');
    const neighbors = result.neighbors || [];
    if (meta) {
      meta.textContent = `${neighbors.length} neighbor${neighbors.length === 1 ? '' : 's'} discovered · ${result.platform || ''} ${result.probe || ''}${result.cached ? ' · cached' : ''}`;
    }
    if (body) {
      if (!neighbors.length) {
        body.innerHTML = `<div class="empty-msg">No neighbors visible in the ARP / neighbor table. If you just connected, generate some traffic (e.g. ping your router) and re-run.</div>`;
      } else {
        body.innerHTML = `
          <div class="scan-list-header">
            <label class="scan-checkbox"><input type="checkbox" id="scan-select-all" checked> Select all</label>
          </div>
          <ul class="scan-list">
            ${neighbors.map((n, i) => `
              <li class="scan-row">
                <label class="scan-checkbox">
                  <input type="checkbox" class="scan-row-check" data-index="${i}" checked>
                  <span class="scan-row-ip"><code>${this.escapeHtml(n.ip)}</code></span>
                  <span class="scan-row-mac">${this.escapeHtml(n.mac || '')}</span>
                  <span class="scan-row-host">${this.escapeHtml(n.hostname || '')}</span>
                  <span class="scan-row-iface">${this.escapeHtml(n.interface || '')}</span>
                </label>
              </li>`).join('')}
          </ul>`;
        const selectAll = document.getElementById('scan-select-all');
        selectAll?.addEventListener('change', () => {
          body.querySelectorAll('.scan-row-check').forEach((cb) => { cb.checked = selectAll.checked; });
        });
      }
    }
    this._scanNeighbors = neighbors;
    const close = () => { modal.classList.add('hidden'); modal.setAttribute('hidden', ''); };
    const closeBtn = modal.querySelector('[data-scan-close]');
    const promoteBtn = document.getElementById('scan-promote-btn');
    const cancelBtn = document.getElementById('scan-cancel-btn');
    closeBtn?.replaceWith(closeBtn.cloneNode(true));
    promoteBtn?.replaceWith(promoteBtn.cloneNode(true));
    cancelBtn?.replaceWith(cancelBtn.cloneNode(true));
    modal.querySelector('[data-scan-close]')?.addEventListener('click', close);
    document.getElementById('scan-cancel-btn')?.addEventListener('click', close);
    document.getElementById('scan-promote-btn')?.addEventListener('click', () => this.promoteScanSelection(close));
    modal.querySelector('.scan-backdrop')?.addEventListener('click', close, { once: true });
  },

  async promoteScanSelection(close) {
    const checked = Array.from(document.querySelectorAll('.scan-row-check')).filter((cb) => cb.checked);
    const items = checked.map((cb) => this._scanNeighbors[Number(cb.dataset.index)]).filter(Boolean);
    if (!items.length) { window.alert('Select at least one neighbor to promote.'); return; }
    try {
      const res = await fetch('/api/discover/local-network/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { this.showScanError(body?.error || `Promote failed (HTTP ${res.status})`); return; }
      if (typeof close === 'function') close();
      await this.loadAssets();
      // Notify the operator how many were created vs. skipped.
      const msg = `Created ${body.createdCount || 0} asset${(body.createdCount || 0) === 1 ? '' : 's'}` +
        ((body.skippedCount || 0) ? ` · skipped ${body.skippedCount} duplicate${body.skippedCount === 1 ? '' : 's'}` : '');
      if (window.toast && typeof window.toast === 'function') window.toast(msg);
      else if (window.Notify?.show) window.Notify.show(msg);
    } catch (err) {
      this.showScanError(err.message || 'Promote failed');
    }
  },

  renderAssetEditor(asset = null) {
    const main = document.getElementById('asset-main');
    const inspector = document.getElementById('asset-inspector');
    this.setMode('assets');
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

  renderCompareWorkspace() {
    const mount = document.getElementById('compare-mount');
    if (!mount) return;
    const snapshots = this.assets.flatMap(asset => (asset.snapshots || []).map(s => ({ ...s, assetName: asset.name })));
    mount.innerHTML = `
      <div class="asset-hero"><div><p class="eyebrow">Mitigation verification</p><h2>Before / after comparison</h2><p>Compare baseline snapshots to verify what changed after mitigation.</p></div></div>
      <form id="compare-form" class="asset-form compact-form">
        <label>Before <select id="compare-before">${snapshots.map(s => `<option value="${this.escapeAttribute(s.id)}">${this.escapeHtml(s.assetName)} · ${this.escapeHtml(s.title)} · ${this.escapeHtml(s.healthScore ?? '—')}</option>`).join('')}</select></label>
        <label>After <select id="compare-after">${snapshots.map(s => `<option value="${this.escapeAttribute(s.id)}">${this.escapeHtml(s.assetName)} · ${this.escapeHtml(s.title)} · ${this.escapeHtml(s.healthScore ?? '—')}</option>`).join('')}</select></label>
        <button class="btn btn-primary" ${snapshots.length < 2 ? 'disabled' : ''}>Compare snapshots</button>
      </form>
      <div class="comparison-grid">${this.comparisons.map(c => this.renderComparisonCard(c)).join('') || '<div class="empty-msg">Comparison results will appear here.</div>'}</div>`;
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

// ─── Asset Profile drawer (Kit alignment pass 5) ────────────────────────
let currentAssetDrawer = null;

async function openAssetDrawer(assetId) {
  const overlay = document.getElementById('asset-profile-drawer');
  if (!overlay || !assetId) return;
  overlay.classList.remove('hidden');
  document.body.classList.add('drawer-open');
  // Load detail
  try {
    const [asset, findingsRes, scopesRes] = await Promise.all([
      fetch(`/api/assets/${encodeURIComponent(assetId)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/findings?assetId=${encodeURIComponent(assetId)}&limit=100`).then(r => r.json()).catch(() => []),
      fetch('/api/scopes').then(r => r.json()).catch(() => []),
    ]);
    if (!asset) return;
    const findings = Array.isArray(findingsRes) ? findingsRes : (findingsRes.findings || []);
    const scopes = Array.isArray(scopesRes) ? scopesRes : (scopesRes.scopes || []);
    currentAssetDrawer = { asset, findings, scopes };
    renderAssetDrawerHeader();
    renderAssetDrawerTab('overview');
    activateAssetDrawerTab('overview');
  } catch (err) {
    console.warn('Asset drawer load failed:', err);
  }
}

function closeAssetDrawer() {
  const overlay = document.getElementById('asset-profile-drawer');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.body.classList.remove('drawer-open');
  currentAssetDrawer = null;
}

function renderAssetDrawerHeader() {
  if (!currentAssetDrawer) return;
  const { asset, findings, scopes } = currentAssetDrawer;
  const typeEl = document.getElementById('asset-drawer-type');
  const critEl = document.getElementById('asset-drawer-criticality');
  const titleEl = document.getElementById('asset-drawer-title');
  const subEl = document.getElementById('asset-drawer-sub');
  if (typeEl) typeEl.textContent = (asset.type || 'asset').toUpperCase();
  if (critEl) critEl.textContent = (asset.criticality || 'medium').toUpperCase();
  if (titleEl) titleEl.textContent = asset.name || asset.id;
  const sub = [
    asset.owner,
    asset.environment,
    asset.last_seen_at ? `last seen ${assetDrawerTimeAgo(asset.last_seen_at)}` : null,
  ].filter(Boolean).join(' · ');
  if (subEl) subEl.textContent = sub || '—';
  // Update tab counts
  const fct = document.getElementById('asset-tab-findings-ct');
  const sct = document.getElementById('asset-tab-services-ct');
  const hct = document.getElementById('asset-tab-history-ct');
  const bct = document.getElementById('asset-tab-baselines-ct');
  const scct = document.getElementById('asset-tab-scopes-ct');
  const snapshots = Array.isArray(asset.snapshots) ? asset.snapshots : (currentAssetDrawer.snapshots || []);
  if (fct) fct.textContent = `· ${findings.length}`;
  if (sct) sct.textContent = `· ${(asset.services || []).length}`;
  if (hct) hct.textContent = `· ${findings.length + snapshots.length}`;
  if (bct) bct.textContent = `· ${snapshots.length}`;
  const membership = scopes.filter(s => scopeIncludesAsset(s, asset));
  if (scct) scct.textContent = `· ${membership.length}`;
}

function renderAssetDrawerTab(tab) {
  if (!currentAssetDrawer) return;
  const bd = document.getElementById('asset-drawer-bd');
  if (!bd) return;
  const { asset, findings, scopes } = currentAssetDrawer;

  if (tab === 'overview') {
    // Health derivation: 100 - weighted finding severity sum (open findings only)
    const weight = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };
    const open = findings.filter(f => f.status === 'open');
    const score = Math.max(20, 100 - open.reduce((a, f) => a + (weight[f.severity] || 0), 0));
    const counts = ['critical','high','medium','low','info'].reduce((m, s) => (m[s] = open.filter(f => f.severity === s).length, m), {});
    const cls = score < 40 ? 'critical' : score < 70 ? 'attention' : '';
    bd.innerHTML = `
      <section class="health-card ${cls}">
        <div class="health-score">${score}<span class="denom">/100</span></div>
        <div>
          <div class="health-bar"><i style="width:${score}%"></i></div>
          <div style="margin-top:6px;font-family:var(--font-mono);font-size:var(--fs-10);color:var(--fg-3);">${open.length} OPEN · ${findings.length - open.length} CLOSED</div>
        </div>
        <div class="severity-distro">
          ${counts.critical ? `<span class="sev crit">CRIT <span class="ct">${counts.critical}</span></span>` : ''}
          ${counts.high     ? `<span class="sev high">HIGH <span class="ct">${counts.high}</span></span>` : ''}
          ${counts.medium   ? `<span class="sev med">MED <span class="ct">${counts.medium}</span></span>`  : ''}
          ${counts.low      ? `<span class="sev low">LOW <span class="ct">${counts.low}</span></span>`    : ''}
          ${counts.info     ? `<span class="sev info">INFO <span class="ct">${counts.info}</span></span>` : ''}
          ${!open.length ? `<span class="sev info">No open findings</span>` : ''}
        </div>
      </section>
      <dl class="identity-grid">
        <dt>ID</dt><dd style="font-family:var(--font-mono);">${assetDrawerEscape((asset.id || '').slice(0, 12))}${asset.id && asset.id.length > 12 ? '…' : ''}</dd>
        <dt>Type</dt><dd>${assetDrawerEscape(asset.type || '')}</dd>
        <dt>Owner</dt><dd>${assetDrawerEscape(asset.owner || '—')}</dd>
        <dt>Env</dt><dd>${assetDrawerEscape(asset.environment || '—')}</dd>
        <dt>Addrs</dt><dd style="font-family:var(--font-mono);font-size:var(--fs-11);">${(asset.addresses || []).map(a => assetDrawerEscape(a.value)).join(', ') || '—'}</dd>
        <dt>Services</dt><dd style="font-family:var(--font-mono);font-size:var(--fs-11);">${(asset.services || []).map(s => `${assetDrawerEscape(String(s.port||''))}/${assetDrawerEscape(s.protocol||'')} ${assetDrawerEscape(s.name||'')}`).join(', ') || '—'}</dd>
        <dt>Tags</dt><dd><div class="tag-list">${(asset.tags || []).map(t => `<span class="tag-pill">${assetDrawerEscape(typeof t === 'string' ? t : (t.tag || t.name || ''))}</span>`).join('') || '—'}</div></dd>
        <dt>Notes</dt><dd>${assetDrawerEscape(asset.notes || '—')}</dd>
      </dl>
    `;
  } else if (tab === 'findings') {
    bd.innerHTML = `
      <table class="asset-table" aria-label="Findings for asset">
        <thead><tr>
          <th class="sev-col" aria-label="severity"></th>
          <th>ID</th>
          <th>SEV</th>
          <th>TITLE</th>
          <th>RULE</th>
          <th>CWE/CVE</th>
          <th>FIRST SEEN</th>
          <th>STATUS</th>
        </tr></thead>
        <tbody>
          ${findings.length ? findings.map(f => {
            const rule = (f.metadata && f.metadata.rule) || '—';
            const cwecve = (f.metadata && (f.metadata.cwe || f.metadata.cve)) || '—';
            const firstSeen = f.first_seen_at ? String(f.first_seen_at).slice(0, 10) : '—';
            return `
            <tr class="${assetDrawerSevClass(f.severity)} linkable" data-finding-id="${assetDrawerEscape(f.id)}">
              <td class="sev-col"></td>
              <td class="id-col">${assetDrawerEscape((f.id || '').slice(0, 8))}</td>
              <td><span class="sev-badge ${assetDrawerSevClass(f.severity)}">${assetDrawerEscape((f.severity||'').toUpperCase())}</span></td>
              <td>${assetDrawerEscape(f.title)}</td>
              <td style="font-family:var(--font-mono);font-size:var(--fs-10);color:var(--fg-2);">${assetDrawerEscape(rule)}</td>
              <td style="font-family:var(--font-mono);font-size:var(--fs-10);color:var(--fg-2);">${assetDrawerEscape(cwecve)}</td>
              <td style="font-family:var(--font-mono);font-size:var(--fs-10);color:var(--fg-mono-ts);">${assetDrawerEscape(firstSeen)}</td>
              <td><span class="status-pill ${assetDrawerEscape(f.status)}">${assetDrawerEscape((f.status||'').toUpperCase())}</span></td>
            </tr>
          `;}).join('') : `<tr><td colspan="8" style="text-align:center;color:var(--fg-3);padding:20px;">No findings recorded for this asset.</td></tr>`}
        </tbody>
      </table>
    `;
  } else if (tab === 'services') {
    bd.innerHTML = `
      <table class="asset-table" aria-label="Services">
        <thead><tr><th>PORT</th><th>PROTO</th><th>SERVICE</th><th>BANNER</th><th>TLS</th></tr></thead>
        <tbody>
          ${(asset.services || []).length ? (asset.services || []).map(s => {
            const tls = s.tls || (s.metadata && s.metadata.tls) || '—';
            return `
            <tr>
              <td style="font-family:var(--font-mono);">${assetDrawerEscape(String(s.port||''))}</td>
              <td style="font-family:var(--font-mono);">${assetDrawerEscape(s.protocol || '')}</td>
              <td>${assetDrawerEscape(s.name || '—')}</td>
              <td style="font-family:var(--font-mono);font-size:var(--fs-11);color:var(--fg-2);">${assetDrawerEscape(s.banner || s.url || '—')}</td>
              <td style="font-family:var(--font-mono);font-size:var(--fs-11);color:var(--fg-2);">${assetDrawerEscape(tls)}</td>
            </tr>
          `;}).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--fg-3);padding:20px;">No services recorded.</td></tr>`}
        </tbody>
      </table>
    `;
  } else if (tab === 'history') {
    const snapshots = Array.isArray(asset.snapshots) ? asset.snapshots : (currentAssetDrawer.snapshots || []);
    const events = [];
    findings.forEach(f => events.push({
      ts: f.first_seen_at || f.created_at || '',
      kind: 'finding',
      title: f.title || f.id,
    }));
    snapshots.forEach(s => events.push({
      ts: s.captured_at || s.created_at || '',
      kind: 'snapshot',
      title: s.title || 'Asset snapshot',
    }));
    events.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    bd.innerHTML = events.length ? `
      <ul class="asset-history">
        ${events.map(ev => `
          <li class="hist-row">
            <span class="hist-ts mono">${assetDrawerEscape(String(ev.ts).slice(0, 10) || '—')}</span>
            <span class="hist-kind ${assetDrawerEscape(ev.kind)}">${assetDrawerEscape(ev.kind.toUpperCase())}</span>
            <span class="hist-label">${assetDrawerEscape(ev.title)}</span>
          </li>
        `).join('')}
      </ul>
    ` : `<div style="padding:24px;text-align:center;color:var(--fg-3);">No history events recorded for this asset.</div>`;
  } else if (tab === 'baselines') {
    const renderBaselines = (snapshots) => {
      if (!snapshots || !snapshots.length) {
        bd.innerHTML = `<div style="padding:24px;text-align:center;color:var(--fg-3);">No baselines captured for this asset.</div>`;
        return;
      }
      bd.innerHTML = snapshots.map(s => {
        const counts = s.findingCounts || {};
        const score = s.healthScore == null ? '—' : Number(s.healthScore);
        const cls = (typeof score === 'number' && score < 40) ? 'critical' : (typeof score === 'number' && score < 70) ? 'attention' : '';
        const capturedAt = s.captured_at ? String(s.captured_at).slice(0, 10) : '—';
        return `
          <div class="baseline-card ${cls}">
            <div class="hd"><span class="title">${assetDrawerEscape(s.title || 'Asset snapshot')}</span><span class="ts mono">${assetDrawerEscape(capturedAt)}</span></div>
            <div class="bd">
              <div class="score">${assetDrawerEscape(String(score))}<span class="denom">/100</span></div>
              <div class="counts">CRIT ${Number(counts.critical || 0)} · HIGH ${Number(counts.high || 0)} · MED ${Number(counts.medium || 0)} · LOW ${Number(counts.low || 0)}</div>
            </div>
            ${s.summary ? `<div class="summary">${assetDrawerEscape(s.summary)}</div>` : ''}
          </div>
        `;
      }).join('');
    };
    const cached = Array.isArray(asset.snapshots) ? asset.snapshots : (currentAssetDrawer.snapshots || null);
    if (cached) {
      renderBaselines(cached);
    } else {
      bd.innerHTML = `<div style="padding:24px;text-align:center;color:var(--fg-3);">Loading baselines…</div>`;
      fetch(`/api/assets/${encodeURIComponent(asset.id)}/snapshots`).then(r => r.ok ? r.json() : []).catch(() => []).then(list => {
        const arr = Array.isArray(list) ? list : [];
        currentAssetDrawer.snapshots = arr;
        renderAssetDrawerHeader();
        renderBaselines(arr);
      });
    }
  } else if (tab === 'scopes') {
    const membership = scopes.filter(s => scopeIncludesAsset(s, asset));
    bd.innerHTML = membership.length
      ? membership.map(s => `
          <div class="scope-membership-row">
            <span class="name">${assetDrawerEscape(s.name)}</span>
            <span class="expires">${s.expires_at ? `expires ${assetDrawerEscape(String(s.expires_at).slice(0,10))}` : 'no expiry'}</span>
            <div class="actions">
              ${(s.allowed_actions||[]).map(a => `<span class="chip allow">${assetDrawerEscape(a)}</span>`).join('')}
              ${(s.blocked_actions||[]).map(a => `<span class="chip block">${assetDrawerEscape(a)}</span>`).join('')}
            </div>
          </div>
        `).join('')
      : `<div style="padding:24px;text-align:center;color:var(--fg-3);">This asset is not currently in any active scope.</div>`;
  }
}

function activateAssetDrawerTab(tab) {
  document.querySelectorAll('#asset-drawer-tabs .drawer-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function scopeIncludesAsset(scope, asset) {
  const t = scope.targets || scope.raw_targets || {};
  if ((t.assetIds || []).includes(asset.id)) return true;
  const addrs = (asset.addresses || []).map(a => (a.value || '').toLowerCase());
  const name = (asset.name || '').toLowerCase();
  for (const k of ['domains','hosts','urls','cidrs']) {
    for (const v of (t[k] || [])) {
      const val = String(v).toLowerCase();
      if (addrs.some(a => a.includes(val) || val.includes(a))) return true;
      if (name && (name.includes(val) || val.includes(name))) return true;
    }
  }
  return false;
}

// Wire it up — called from ScopePage.init()
function bindAssetDrawerOnce() {
  if (window.__assetDrawerBound) return;
  window.__assetDrawerBound = true;
  // Close handlers
  document.querySelectorAll('[data-asset-drawer-close]').forEach(el => el.addEventListener('click', closeAssetDrawer));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && currentAssetDrawer) closeAssetDrawer();
  });
  // Tab clicks
  document.getElementById('asset-drawer-tabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.drawer-tab')?.dataset.tab;
    if (!tab) return;
    activateAssetDrawerTab(tab);
    renderAssetDrawerTab(tab);
  });
  // Asset row click (delegate from #assets-mode-panel)
  document.getElementById('assets-mode-panel')?.addEventListener('click', e => {
    const row = e.target.closest('[data-asset-id]');
    if (!row) return;
    // Only trigger drawer when clicking the asset list row itself
    if (!row.classList.contains('asset-list-item')) return;
    e.preventDefault();
    openAssetDrawer(row.dataset.assetId);
  });
  // Footer actions
  document.getElementById('asset-drawer-audit-btn')?.addEventListener('click', () => {
    if (!currentAssetDrawer) return;
    window.Router?.navigate?.('chat');
    closeAssetDrawer();
  });
  document.getElementById('asset-drawer-export-btn')?.addEventListener('click', () => {
    if (!currentAssetDrawer) return;
    const blob = new Blob([JSON.stringify(currentAssetDrawer.asset, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${currentAssetDrawer.asset.name || 'asset'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('asset-drawer-archive-btn')?.addEventListener('click', async () => {
    if (!currentAssetDrawer) return;
    if (!confirm(`Archive asset "${currentAssetDrawer.asset.name}"?`)) return;
    await fetch(`/api/assets/${encodeURIComponent(currentAssetDrawer.asset.id)}`, { method: 'DELETE' }).catch(() => null);
    closeAssetDrawer();
    if (window.ScopePage && typeof window.ScopePage.loadAll === 'function') window.ScopePage.loadAll();
  });
}

// Local helpers (prefixed to avoid name collisions with ScopePage methods)
function assetDrawerEscape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function assetDrawerTimeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '';
  const d = ms / 60000;
  return d < 60 ? `${Math.round(d)}m ago` : d < 1440 ? `${Math.round(d/60)}h ago` : `${Math.round(d/1440)}d ago`;
}
function assetDrawerSevClass(s) { return ({ critical: 'crit', high: 'high', medium: 'med', low: 'low', info: 'info' })[s] || 'info'; }
