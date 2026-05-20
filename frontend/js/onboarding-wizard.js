// First-run onboarding wizard.
//
// Four steps:
//   1. Welcome       — what is PHANTOM, what we'll set up
//   2. Provider      — pick provider, paste API key, test
//   3. First scope   — pick an ROE template, name + targets
//   4. Preview       — stub synthesis card showing what they'll see
//                      when their first real run finishes
//
// Step 4 reuses window.SynthesisCard.render so the preview is
// pixel-identical to the real card — the wizard literally previews the
// "what does the output look like" question every new operator asks.

(function () {
  const STEPS = ['welcome', 'provider', 'scope', 'preview'];

  const state = {
    open: false,
    step: 'welcome',
    provider: null,
    baseUrl: '',
    apiKey: '',
    model: null,
    scopeName: 'Lab Recon',
    scopeTargets: '10.0.0.0/24',
    roeTemplate: null,
    providers: [],
    roeTemplates: [],
    cache: {
      statusFetched: false,
      synthesisStub: null,
    },
  };

  function baseUrlForProvider(id) {
    const p = state.providers.find((x) => x.id === id);
    return p ? (p.baseUrl || '') : '';
  }

  function esc(v) {
    const d = document.createElement('div');
    d.textContent = v == null ? '' : String(v);
    return d.innerHTML;
  }
  function escAttr(v) { return esc(v).replace(/"/g, '&quot;'); }

  function $(sel) { return document.querySelector(sel); }
  function modalEl() { return document.getElementById('onboarding-modal'); }

  async function fetchJson(url, init) {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── Step renderers ────────────────────────────────────────────────────
  function renderWelcome() {
    return `
      <div class="onb-welcome">
        <p class="onb-lede">PHANTOM is a <strong>governed AI security-ops cockpit</strong>.
        Every tool call is scope-checked and traced. Let's get you set up in under two minutes.</p>
        <ul class="onb-bullets">
          <li><span class="onb-bul-icon">①</span> Wire up an OpenAI-compatible provider.</li>
          <li><span class="onb-bul-icon">②</span> Define your first scope so the agent knows what's in-bounds.</li>
          <li><span class="onb-bul-icon">③</span> See a preview of the end-of-run synthesis.</li>
        </ul>
        <p class="onb-hint">You can re-open this wizard any time from Settings.</p>
      </div>
    `;
  }

  async function ensureProviders() {
    if (state.providers.length) return;
    try {
      const data = await fetchJson('/api/providers');
      state.providers = data.providers || [];
      if (!state.provider) state.provider = data.default || (state.providers[0] && state.providers[0].id) || null;
      // Seed the URL field from the selected provider's registry default so
      // operators see what we'll call and can override per-deploy (e.g. point
      // a 'custom' or 'hermes' selection at a self-hosted proxy on the LAN).
      if (!state.baseUrl && state.provider) state.baseUrl = baseUrlForProvider(state.provider);
    } catch {
      state.providers = [];
    }
    // After the registry seed, overlay current /api/settings so the wizard
    // shows the *active* config (env-driven or previously persisted) rather
    // than a stale registry default. Without this, a re-opened wizard
    // misrepresents reality and a casual click-through silently overwrites
    // working values (e.g. an env-set host.docker.internal URL).
    try {
      const cur = await fetchJson('/api/settings');
      if (cur.provider) state.provider = cur.provider;
      if (cur.baseUrl)  state.baseUrl  = cur.baseUrl;
      // cur.apiKey is masked server-side ("••••xxxx"); leave state.apiKey
      // alone so the password input keeps its empty placeholder.
    } catch { /* non-fatal — registry seed still applies */ }
  }

  async function renderProvider() {
    await ensureProviders();
    const opts = state.providers.map(p => {
      const sel = p.id === state.provider ? ' selected' : '';
      const tag = p.unavailable ? ' (unavailable)' : '';
      return `<option value="${escAttr(p.id)}"${sel}>${esc(p.name || p.id)}${tag}</option>`;
    }).join('');
    return `
      <div class="onb-form">
        <p class="onb-lede">Pick an OpenAI-compatible provider. You can change this any time in Settings.</p>
        <label class="onb-field">
          <span class="onb-label">Provider</span>
          <select id="onb-provider-select">${opts || '<option value="">No providers wired</option>'}</select>
        </label>
        <label class="onb-field">
          <span class="onb-label">Base URL <small>(override for self-hosted proxies; required when "Custom" is selected)</small></span>
          <input type="text" id="onb-base-url" placeholder="https://…/v1" value="${escAttr(state.baseUrl)}" autocomplete="off" spellcheck="false" />
        </label>
        <label class="onb-field">
          <span class="onb-label">API key <small>(optional for local endpoints like Ollama)</small></span>
          <input type="password" id="onb-api-key" placeholder="sk-…" value="${escAttr(state.apiKey)}" autocomplete="off" />
        </label>
        <div class="onb-test-row">
          <button class="btn btn-secondary" id="onb-test-btn">Test connection</button>
          <span class="onb-test-result" id="onb-test-result"></span>
        </div>
        <p class="onb-hint">Stored as-is in your local database (sqlite). Never shipped off-device.</p>
      </div>
    `;
  }

  async function ensureRoeTemplates() {
    if (state.roeTemplates.length) return;
    try {
      const data = await fetchJson('/api/scopes/roe-templates');
      state.roeTemplates = data.templates || [];
      if (!state.roeTemplate && state.roeTemplates[0]) state.roeTemplate = state.roeTemplates[0].id;
    } catch {
      state.roeTemplates = [];
    }
  }

  async function renderScope() {
    await ensureRoeTemplates();
    const templates = state.roeTemplates.map(t => `
      <label class="onb-tpl ${t.id === state.roeTemplate ? 'is-selected' : ''}">
        <input type="radio" name="onb-roe" value="${escAttr(t.id)}" ${t.id === state.roeTemplate ? 'checked' : ''}>
        <span class="onb-tpl-body">
          <strong>${esc(t.name)}</strong>
          <small>${esc(t.summary || t.description || '')}</small>
        </span>
      </label>
    `).join('') || '<p class="onb-hint">No ROE templates available; you can still proceed and define rules later.</p>';

    return `
      <div class="onb-form">
        <p class="onb-lede">A scope defines what targets are in-bounds and which classes of action are allowed. Pick a starting template:</p>
        <div class="onb-tpl-grid">${templates}</div>
        <label class="onb-field">
          <span class="onb-label">Scope name</span>
          <input type="text" id="onb-scope-name" value="${escAttr(state.scopeName)}" />
        </label>
        <label class="onb-field">
          <span class="onb-label">Targets <small>(hosts, CIDRs, or URLs, one per line)</small></span>
          <textarea id="onb-scope-targets" rows="3">${esc(state.scopeTargets)}</textarea>
        </label>
        <p class="onb-hint">The agent will refuse any action outside this scope unless you grant an operator override.</p>
      </div>
    `;
  }

  async function renderPreview() {
    if (!state.cache.synthesisStub) {
      try {
        state.cache.synthesisStub = await fetchJson('/api/runs/preview/synthesis?preview=stub');
      } catch {
        state.cache.synthesisStub = null;
      }
    }
    const host = `<div id="onb-synth-host" class="onb-synth-host"></div>`;
    return `
      <div class="onb-preview">
        <p class="onb-lede">When a run finishes, PHANTOM produces an end-of-run synthesis with posture, highlights, and recommended next steps. Here's a sample:</p>
        ${host}
        <p class="onb-hint">Click <strong>Finish</strong> to save your setup and head to the Chat surface.</p>
      </div>
    `;
  }

  async function renderBody() {
    const body = document.getElementById('onboarding-body');
    if (!body) return;
    body.classList.add('is-busy');
    let html = '';
    if (state.step === 'welcome')  html = renderWelcome();
    if (state.step === 'provider') html = await renderProvider();
    if (state.step === 'scope')    html = await renderScope();
    if (state.step === 'preview')  html = await renderPreview();
    body.innerHTML = html;
    body.classList.remove('is-busy');
    bindStepHandlers();
    renderStepper();
    renderFooter();
    if (state.step === 'preview' && state.cache.synthesisStub && window.SynthesisCard) {
      const host = document.getElementById('onb-synth-host');
      window.SynthesisCard.render(host, state.cache.synthesisStub, { preview: true });
    }
  }

  function renderStepper() {
    const stepper = document.getElementById('onboarding-stepper');
    if (!stepper) return;
    const idx = STEPS.indexOf(state.step);
    stepper.querySelectorAll('.step').forEach((li, i) => {
      li.classList.toggle('is-current', i === idx);
      li.classList.toggle('is-done',    i <  idx);
    });
  }

  function renderFooter() {
    const back = $('[data-onboarding-back]');
    const next = $('[data-onboarding-next]');
    if (!next || !back) return;
    const idx = STEPS.indexOf(state.step);
    back.hidden = idx === 0;
    next.textContent = idx === STEPS.length - 1 ? 'Finish' : 'Next →';
  }

  function bindStepHandlers() {
    if (state.step === 'provider') {
      const sel = document.getElementById('onb-provider-select');
      const key = document.getElementById('onb-api-key');
      const urlInput = document.getElementById('onb-base-url');
      const testBtn = document.getElementById('onb-test-btn');
      const resultEl = document.getElementById('onb-test-result');
      if (sel) sel.onchange = () => {
        state.provider = sel.value;
        // Re-seed the URL field from the new provider's registry default
        // unless the operator has typed a value that diverges from the
        // previous provider's default (i.e. they're customizing).
        const nextDefault = baseUrlForProvider(state.provider);
        if (urlInput && (urlInput.value === '' || state.providers.some((p) => p.baseUrl === urlInput.value))) {
          urlInput.value = nextDefault;
          state.baseUrl = nextDefault;
        }
      };
      if (key) key.oninput = () => { state.apiKey = key.value; };
      if (urlInput) urlInput.oninput = () => { state.baseUrl = urlInput.value.trim(); };
      if (testBtn) testBtn.onclick = async () => {
        if (!state.provider) { resultEl.textContent = 'pick a provider first'; return; }
        // Persist provisional settings so the /test endpoint exercises this
        // selection (it uses the active config).
        await persistProviderSettings();
        testBtn.disabled = true;
        const original = testBtn.textContent;
        testBtn.textContent = 'Testing…';
        resultEl.textContent = '';
        resultEl.className = 'onb-test-result';
        try {
          const data = await fetchJson('/api/settings/test', { method: 'POST' });
          if (data.ok || data.success) {
            resultEl.textContent = `✓ ${data.message || 'connection ok'}`;
            resultEl.className = 'onb-test-result is-ok';
          } else {
            resultEl.textContent = `✗ ${data.message || data.error || 'failed'}`;
            resultEl.className = 'onb-test-result is-bad';
          }
        } catch (err) {
          resultEl.textContent = `✗ ${err.message}`;
          resultEl.className = 'onb-test-result is-bad';
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = original;
        }
      };
    }

    if (state.step === 'scope') {
      document.querySelectorAll('input[name="onb-roe"]').forEach((r) => {
        r.addEventListener('change', () => {
          state.roeTemplate = r.value;
          document.querySelectorAll('.onb-tpl').forEach((label) => {
            label.classList.toggle('is-selected', label.contains(r));
          });
        });
      });
      const name = document.getElementById('onb-scope-name');
      const targets = document.getElementById('onb-scope-targets');
      if (name) name.oninput = () => { state.scopeName = name.value; };
      if (targets) targets.oninput = () => { state.scopeTargets = targets.value; };
    }
  }

  async function persistProviderSettings() {
    const body = { provider: state.provider };
    // Send baseUrl when the operator has typed something AND it differs from
    // the registry default for the current provider — that way casual picks
    // (Hermes/OpenAI/etc.) round-trip the canonical URL, while a customized
    // value (or any "custom" selection) wins and gets persisted.
    if (state.baseUrl && state.baseUrl !== baseUrlForProvider(state.provider)) {
      body.baseUrl = state.baseUrl;
    } else if (state.provider === 'custom' && state.baseUrl) {
      body.baseUrl = state.baseUrl;
    }
    if (state.apiKey && state.apiKey !== '••••••••') body.apiKey = state.apiKey;
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch { /* non-fatal — user can retry from Settings */ }
  }

  async function persistScope() {
    const targets = state.scopeTargets
      .split(/[\n,]/g)
      .map(s => s.trim())
      .filter(Boolean);
    if (!targets.length) return;
    // Parse via the server-side target parser so we get the same
    // host/cidr/url classification the Scope Builder uses.
    let scopeFields = { hosts: [], cidrs: [], urls: [], domains: [] };
    try {
      const parsed = await fetchJson('/api/scopes/parse-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: targets.join(' ') }),
      });
      scopeFields = parsed.scopeFields || scopeFields;
    } catch { /* fall back to hosts bucket */ scopeFields.hosts = targets; }

    const body = {
      name: state.scopeName || 'My first scope',
      targets: scopeFields,
      allowedActions: ['recon'],
      blockedActions: ['destructive'],
      notes: state.roeTemplate ? `ROE template: ${state.roeTemplate}` : null,
    };
    try {
      await fetch('/api/scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch { /* don't block completion on scope failure */ }
  }

  async function advance() {
    const idx = STEPS.indexOf(state.step);
    if (idx === STEPS.length - 1) {
      await finish();
      return;
    }
    // Side-effects on advance.
    if (state.step === 'provider') await persistProviderSettings();
    if (state.step === 'scope')    await persistScope();
    state.step = STEPS[idx + 1];
    await renderBody();
  }

  async function back() {
    const idx = STEPS.indexOf(state.step);
    if (idx === 0) return;
    state.step = STEPS[idx - 1];
    await renderBody();
  }

  async function finish() {
    try { await fetch('/api/onboarding/complete', { method: 'POST' }); } catch {}
    close();
    window.dispatchEvent(new CustomEvent('phantom:onboarding-complete'));
    window.Router?.navigate?.('chat');
  }

  async function skip() {
    try { await fetch('/api/onboarding/complete', { method: 'POST' }); } catch {}
    close();
  }

  function close() {
    state.open = false;
    const modal = modalEl();
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('hidden', '');
    }
  }

  async function open() {
    const modal = modalEl();
    if (!modal) return;
    state.open = true;
    state.step = 'welcome';
    modal.removeAttribute('hidden');
    modal.classList.remove('hidden');
    bindGlobalHandlers();
    await renderBody();
  }

  function bindGlobalHandlers() {
    const modal = modalEl();
    if (!modal || modal.dataset.bound === '1') return;
    modal.dataset.bound = '1';
    modal.querySelectorAll('[data-onboarding-close], [data-onboarding-skip]').forEach((el) => {
      el.addEventListener('click', () => skip());
    });
    const nextBtn = modal.querySelector('[data-onboarding-next]');
    const backBtn = modal.querySelector('[data-onboarding-back]');
    if (nextBtn) nextBtn.addEventListener('click', () => advance());
    if (backBtn) backBtn.addEventListener('click', () => back());
    document.addEventListener('keydown', (event) => {
      if (!state.open) return;
      if (event.key === 'Escape') skip();
    });
  }

  async function maybeOpen() {
    try {
      const status = await fetchJson('/api/onboarding/status');
      if (status.firstRun) await open();
    } catch { /* server unreachable — leave the splash → welcome flow alone */ }
  }

  window.OnboardingWizard = { open, close, maybeOpen };
})();
