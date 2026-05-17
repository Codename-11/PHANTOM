window.SettingsPage = {
  init() {
    this.mountExistingSettingsBody();
    this.initTabs();
    this.initPromptPreview();

    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'settings') {
        window.Settings?.load?.();
        this.loadPromptPreview();
      }
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
      });
    });
  },

  initPromptPreview() {
    document.getElementById('refresh-prompt-preview')?.addEventListener('click', () => this.loadPromptPreview());
  },

  async loadPromptPreview() {
    const target = document.getElementById('system-prompt-preview');
    if (!target) return;
    target.textContent = 'Loading prompt preview…';
    try {
      const res = await fetch('/api/prompts/preview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      target.textContent = data.content || '';
      document.getElementById('system-prompt-meta').textContent = `${data.length || 0} chars · read-only`;
    } catch (err) {
      target.textContent = `Failed to load prompt preview: ${err.message}`;
    }
  },
};
