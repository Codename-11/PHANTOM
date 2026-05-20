window.SettingsPage = {
  profiles: [],
  fragments: [],
  toolpacks: [],

  init() {
    this.mountExistingSettingsBody();
    this.initTabs();
    this.initPromptPreview();
    this.renderStaticPanels();
    this.initOnboardingControl();
    this.initSynthesisLlmToggle();
    this.initDocsToggle();
    this.initSidebarDocsLink();

    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'settings') {
        window.Settings?.load?.();
        this.loadPromptAdmin();
      }
    });
    this.loadPromptAdmin();
  },

  // LLM-synthesis feature flag toggle (Advanced panel). Persists to the
  // settings table via PUT /api/settings; the synthesis route reads it on
  // each fetch so the change takes effect immediately on the next card
  // render — no restart required.
  initSynthesisLlmToggle() {
    const toggle = document.getElementById('settings-synthesis-llm-toggle');
    if (!toggle || toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';
    // Mirror current server state on mount.
    fetch('/api/settings').then(r => r.json()).then(s => {
      toggle.checked = !!s.synthesisLlmEnabled;
    }).catch(() => {});
    toggle.addEventListener('change', async () => {
      try {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synthesisLlmEnabled: toggle.checked }),
        });
      } catch (err) {
        toggle.checked = !toggle.checked;
        alert(`Failed to update setting: ${err.message}`);
      }
    });
  },

  // Built-in user-docs toggle (Advanced panel). Mirrors the LLM-synthesis
  // toggle's shape — read state on mount, PUT on change. A note appears
  // below if the toggle's new value won't take effect until restart.
  initDocsToggle() {
    const toggle = document.getElementById('settings-docs-toggle');
    if (!toggle || toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';
    fetch('/api/settings').then(r => r.json()).then(s => {
      toggle.checked = s.docsEnabled !== false;
      toggle.dataset.initial = toggle.checked ? '1' : '0';
    }).catch(() => {});
    toggle.addEventListener('change', async () => {
      try {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docsEnabled: toggle.checked }),
        });
        // Surface the restart-required note when the new state differs
        // from boot — the static handler is mounted at server startup and
        // can't be swapped mid-process.
        const card = document.getElementById('settings-docs-card');
        if (card) {
          const initial = toggle.dataset.initial === '1';
          const drift = initial !== toggle.checked;
          let hint = card.querySelector('.settings-docs-restart-hint');
          if (drift && !hint) {
            hint = document.createElement('p');
            hint.className = 'settings-docs-restart-hint';
            hint.textContent = 'Restart the server (`npm run dev` or `npm start`) for this change to take effect.';
            card.appendChild(hint);
          } else if (!drift && hint) {
            hint.remove();
          }
        }
      } catch (err) {
        toggle.checked = !toggle.checked;
        alert(`Failed to update setting: ${err.message}`);
      }
    });
  },

  // Sidebar Docs link visibility — only show when the server reports
  // docsEnabled and the build is reachable. We probe HEAD /docs/ once
  // on mount; the link stays hidden if the build is missing even when
  // the flag is on, so operators don't click into a 404.
  async initSidebarDocsLink() {
    const link = document.getElementById('sidebar-docs-link');
    if (!link || link.dataset.bound === '1') return;
    link.dataset.bound = '1';
    try {
      const settings = await fetch('/api/settings').then(r => r.json());
      if (!settings.docsEnabled) return;
      const head = await fetch('/docs/', { method: 'HEAD' }).catch(() => null);
      if (head && head.ok) link.removeAttribute('hidden');
    } catch {}
  },

  // "Open wizard" button on Advanced panel. Resets the sticky completion
  // flag and re-summons the wizard so the operator can re-walk setup.
  initOnboardingControl() {
    const btn = document.getElementById('settings-onboarding-open');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Opening…';
      try {
        await fetch('/api/onboarding/reset', { method: 'POST' });
        await window.OnboardingWizard?.open?.();
      } catch (err) {
        btn.textContent = `Failed: ${err.message}`;
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1600);
        return;
      }
      btn.textContent = original;
      btn.disabled = false;
    });
  },

  mountExistingSettingsBody() {
    const mount = document.getElementById('settings-page-form-mount');
    const body = document.querySelector('#settings-panel .settings-body');
    if (!mount || !body || body.dataset.mounted === 'page') return;
    mount.appendChild(body);
    body.dataset.mounted = 'page';
  },

  initTabs() {
    const tabs = Array.from(document.querySelectorAll('.settings-page-tab'));
    const panels = Array.from(document.querySelectorAll('.settings-tab-panel'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.settingsTab;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        panels.forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === target));
        if (target === 'prompts') this.loadPromptAdmin();
        if (target === 'tools' || target === 'security') this.loadToolpacks();
        // The Profiles subtab lives inside the Tools panel as its own
        // stacked section (see frontend/index.html — third block under
        // data-settings-panel="tools"). Loading on tab-activate keeps
        // the list fresh without polling.
        if (target === 'tools') window.ProfilesPanel?.load?.();
        if (target === 'general' || target === 'behavior' || target === 'advanced') this.renderStaticPanels();
        // A6 — Diagnostics tab paints the same full card used by Dash.
        if (target === 'diagnostics') window.DiagnosticsCard?.show?.('settings');
      });
    });
    // A6 — Wire the Diagnostics tab's refresh button.
    document.getElementById('diag-refresh-tab-btn')?.addEventListener('click', () => {
      window.DiagnosticsCard?.show?.('settings');
    });
  },

  initPromptPreview() {
    document.getElementById('refresh-prompt-preview')?.addEventListener('click', () => this.loadPromptPreview());
    document.getElementById('save-prompt-profile')?.addEventListener('click', () => this.saveProfile());
    document.getElementById('save-prompt-fragment')?.addEventListener('click', () => this.saveFragment());
    document.getElementById('refresh-toolpacks-btn')?.addEventListener('click', () => this.loadToolpacks());
    document.getElementById('prompt-profile-select')?.addEventListener('change', () => {
      this.populateProfileForm();
      this.loadPromptPreview();
    });
    document.getElementById('prompt-fragment-select')?.addEventListener('change', () => this.populateFragmentForm());
  },

  renderStaticPanels() {
    const presenter = window.SettingsPagePresenter;
    if (!presenter) return;
    const providerId = document.getElementById('setting-provider-id')?.value;
    const providerName = window.Settings?.providersById?.[providerId]?.name;
    const settings = {
      baseUrl: document.getElementById('setting-base-url')?.value,
      model: document.getElementById('setting-model')?.value,
      workspace: document.getElementById('setting-workspace')?.value,
      providerName,
    };
    const general = document.getElementById('settings-general-overview');
    const behavior = document.getElementById('settings-behavior-overview');
    const advanced = document.getElementById('settings-advanced-overview');
    if (general) general.innerHTML = presenter.renderGeneralOverview(settings);
    if (behavior) behavior.innerHTML = presenter.renderBehaviorOverview();
    if (advanced) advanced.innerHTML = presenter.renderAdvancedOverview();
  },

  async fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  },

  async loadPromptAdmin() {
    await Promise.all([this.loadProfiles(), this.loadFragments(), this.loadToolpacks()]);
    this.renderStaticPanels();
    this.loadPromptPreview();
  },

  async loadProfiles() {
    const select = document.getElementById('prompt-profile-select');
    if (!select) return;
    const res = await fetch('/api/prompts/profiles');
    if (!res.ok) return;
    this.profiles = await res.json();
    select.innerHTML = '<option value="">Default base</option>' + this.profiles.map(profile => `<option value="${this.escapeAttribute(profile.id)}">${this.escapeHtml(profile.name)}</option>`).join('');
    this.populateProfileForm();
  },

  async loadFragments() {
    const select = document.getElementById('prompt-fragment-select');
    if (!select) return;
    const res = await fetch('/api/prompts/fragments?enabled=false');
    const enabledRes = await fetch('/api/prompts/fragments');
    if (!res.ok || !enabledRes.ok) return;
    const disabled = await res.json();
    const enabled = await enabledRes.json();
    const byId = new Map([...enabled, ...disabled].map(fragment => [fragment.id, fragment]));
    this.fragments = Array.from(byId.values());
    select.innerHTML = '<option value="">New fragment</option>' + this.fragments.map(fragment => `<option value="${this.escapeAttribute(fragment.id)}">${this.escapeHtml(fragment.kind)} · ${this.escapeHtml(fragment.name)}</option>`).join('');
    this.populateFragmentForm();
  },

  populateProfileForm() {
    const id = document.getElementById('prompt-profile-select')?.value;
    const profile = this.profiles.find(item => item.id === id);
    const name = document.getElementById('prompt-profile-name');
    const mode = document.getElementById('prompt-profile-mode');
    if (name) name.value = profile?.name || '';
    if (mode) mode.value = profile?.mode || '';
  },

  populateFragmentForm() {
    const id = document.getElementById('prompt-fragment-select')?.value;
    const fragment = this.fragments.find(item => item.id === id);
    const kind = document.getElementById('prompt-fragment-kind');
    const name = document.getElementById('prompt-fragment-name');
    const body = document.getElementById('prompt-fragment-body');
    if (kind) kind.value = fragment?.kind || 'custom';
    if (name) name.value = fragment?.name || '';
    if (body) body.value = fragment?.body || '';
  },

  async saveProfile() {
    const id = document.getElementById('prompt-profile-select')?.value;
    const payload = {
      name: document.getElementById('prompt-profile-name')?.value || 'Untitled profile',
      mode: document.getElementById('prompt-profile-mode')?.value || 'general',
    };
    const res = await fetch(id ? `/api/prompts/profiles/${encodeURIComponent(id)}` : '/api/prompts/profiles', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();
    await this.loadProfiles();
    const select = document.getElementById('prompt-profile-select');
    if (select) select.value = saved.id;
    this.loadPromptPreview();
  },

  async saveFragment() {
    const id = document.getElementById('prompt-fragment-select')?.value;
    const profileId = document.getElementById('prompt-profile-select')?.value || null;
    const payload = {
      profileId,
      kind: document.getElementById('prompt-fragment-kind')?.value || 'custom',
      name: document.getElementById('prompt-fragment-name')?.value || 'Untitled fragment',
      body: document.getElementById('prompt-fragment-body')?.value || '',
      enabled: true,
    };
    const res = await fetch(id ? `/api/prompts/fragments/${encodeURIComponent(id)}` : '/api/prompts/fragments', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await this.loadFragments();
    this.loadPromptPreview();
  },

  async loadToolpacks() {
    const target = document.getElementById('toolpack-settings-list');
    const security = document.getElementById('settings-scope-policy');
    try {
      // Fetch toolpacks and installer status in parallel so each toolpack
      // card can decorate its tool rows with green/red availability dots
      // and a "N/M on host" chip — the operator sees what's already there
      // before they consider installing.
      const [res, statusRes] = await Promise.all([
        this.fetchWithTimeout('/api/toolpacks'),
        this.fetchWithTimeout('/api/installer/status').catch(() => null),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.toolpacks = await res.json();
      let availabilityByCommand = {};
      if (statusRes && statusRes.ok) {
        const status = await statusRes.json();
        availabilityByCommand = Object.fromEntries((status.tools || []).map(t => [t.command, !!t.available]));
      }
      if (target) target.innerHTML = window.SettingsPagePresenter?.renderToolpackCards(this.toolpacks, { availabilityByCommand }) || this.toolpacks.map(pack => `
          <article class="toolpack-card">
            <div><strong>${this.escapeHtml(pack.name)}</strong><p>${this.escapeHtml(pack.summary)}</p></div>
            <div class="asset-chip-row"><span class="asset-chip">Risks: ${this.escapeHtml((pack.risks || []).join(', '))}</span><span class="asset-chip">${pack.policy?.scopeRequired ? 'Scope required' : 'Scope optional'}</span></div>
            <details><summary>${(pack.tools || []).length} tools</summary>${(pack.tools || []).map(tool => `<div class="target-row"><span>${this.escapeHtml(tool.name)} · ${this.escapeHtml(tool.risk)}</span><strong>${this.escapeHtml(tool.installHint || 'installed externally')}</strong></div>`).join('')}</details>
          </article>`).join('');
      if (security) security.innerHTML = window.SettingsPagePresenter?.renderSecurityOverview(this.toolpacks) || `<strong>Governed execution</strong><p>Risky tools are blocked before execution unless selected scope policy allows the risk class and every extracted target is in scope.</p><div class="asset-chip-row">${this.toolpacks.map(pack => `<span class="asset-chip">${this.escapeHtml(pack.name)}</span>`).join('')}</div>`;
      window.ScopePage?.renderToolpackSelector?.();
    } catch (err) {
      if (target) target.innerHTML = window.SettingsPagePresenter?.renderToolpackError(err.name === 'AbortError' ? 'Timed out loading /api/toolpacks' : err.message) || `<div class="empty-msg danger">Failed to load toolpacks: ${this.escapeHtml(err.message)}</div>`;
      if (security) security.innerHTML = window.SettingsPagePresenter?.renderSecurityOverview(this.toolpacks) || security.innerHTML;
    }
  },

  async loadPromptPreview() {
    const target = document.getElementById('system-prompt-preview');
    if (!target) return;
    target.textContent = 'Loading prompt preview…';
    try {
      const profileId = document.getElementById('prompt-profile-select')?.value || '';
      const scopeId = document.getElementById('active-scope-select')?.value || '';
      const qs = new URLSearchParams();
      if (profileId) qs.set('profileId', profileId);
      if (scopeId) qs.set('scopeId', scopeId);
      const toolpackIds = Array.from(document.getElementById('active-toolpack-select')?.selectedOptions || []).map(option => option.value).filter(Boolean);
      if (toolpackIds.length) qs.set('toolpackIds', toolpackIds.join(','));
      const res = await fetch(`/api/prompts/preview${qs.toString() ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      target.textContent = data.content || '';
      document.getElementById('system-prompt-meta').textContent = `${data.length || 0} chars · ${data.profile?.name || 'default'} · ${data.scope?.name || 'no scope'} · ${(data.toolpacks || []).map(pack => pack.name).join(', ') || 'no toolpacks'}`;
    } catch (err) {
      target.textContent = `Failed to load prompt preview: ${err.message}`;
    }
  },

  escapeHtml(value) { const div = document.createElement('div'); div.textContent = value == null ? '' : String(value); return div.innerHTML; },
  escapeAttribute(value) { return this.escapeHtml(value).replace(/"/g, '&quot;'); },
};
