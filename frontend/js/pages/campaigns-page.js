// Campaigns page wrapper. Glue layer between:
//   - CampaignClient (network)
//   - CampaignForm    (pure form presenter + validator)
//   - CampaignPresenter (pure list + detail renderer)
//
// Owns: list rendering, detail-drawer hydration, create-overlay state,
// lifecycle button dispatch, and refs cache (scopes/profiles/toolpacks/
// backends).

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ── State ──────────────────────────────────────────────────────────────
  const state = {
    refs: null,           // { scopes, profiles, toolpacks, backends }
    selectedId: null,
    detail: null,         // most recent replay payload
    formState: null,
    refsPromise: null,
  };

  function ensureRefs() {
    if (state.refs) return Promise.resolve(state.refs);
    if (state.refsPromise) return state.refsPromise;
    state.refsPromise = Promise.all([
      window.CampaignClient.scopes().catch(() => []),
      window.CampaignClient.profiles().catch(() => []),
      window.CampaignClient.toolpacks().catch(() => []),
      window.CampaignClient.backends().catch(() => [{ id: 'phantom-native', available: true }]),
    ]).then(([scopes, profiles, toolpacks, backends]) => {
      state.refs = { scopes, profiles, toolpacks, backends };
      return state.refs;
    });
    return state.refsPromise;
  }

  // ── List ──────────────────────────────────────────────────────────────
  async function paintList() {
    const host = $('campaigns-list');
    if (!host) return;
    let campaigns = [];
    try { campaigns = await window.CampaignClient.list(); } catch { /* keep empty */ }
    host.innerHTML = window.CampaignPresenter.renderList(campaigns);
    host.setAttribute('data-empty', String(!campaigns.length));
    if (state.selectedId && !campaigns.find((c) => c.id === state.selectedId)) {
      closeDetail();
    }
  }

  // ── Detail drawer ─────────────────────────────────────────────────────
  function closeDetail() {
    const drawer = $('campaign-detail-drawer');
    if (drawer) drawer.classList.add('hidden');
    state.selectedId = null;
    state.detail = null;
    document.querySelectorAll('.campaign-row.selected').forEach((el) => el.classList.remove('selected'));
  }

  async function openDetail(id) {
    state.selectedId = id;
    document.querySelectorAll('.campaign-row').forEach((el) => {
      el.classList.toggle('selected', el.dataset.campaignId === id);
    });
    const drawer = $('campaign-detail-drawer');
    if (!drawer) return;
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-busy', 'true');
    try {
      const replay = await window.CampaignClient.replay(id);
      state.detail = replay;
      paintDetail(replay);
    } catch (err) {
      $('campaign-detail-title').textContent = 'Failed to load';
      $('campaign-detail-objective').textContent = err.message;
    } finally {
      drawer.removeAttribute('aria-busy');
    }
  }

  function paintDetail(replay) {
    const P = window.CampaignPresenter;
    $('campaign-detail-title').textContent = replay.campaign.title;
    $('campaign-detail-objective').textContent = replay.campaign.objective;
    $('campaign-detail-id').textContent = replay.campaign.id;

    const pill = $('campaign-detail-pill');
    pill.className = `campaign-pill campaign-pill-${replay.campaign.status}`;
    pill.textContent = replay.campaign.status;

    $('campaign-detail-actions').innerHTML = P.renderActions(replay.campaign);
    $('campaign-tab-goals-ct').textContent = replay.goals.length ? `· ${replay.goals.length}` : '';
    $('campaign-tab-runs-ct').textContent = replay.runs.length ? `· ${replay.runs.length}` : '';

    const body = $('campaign-detail-body');
    body.querySelector('[data-pane="overview"]').innerHTML = P.renderOverviewPane(replay);
    body.querySelector('[data-pane="goals"]').innerHTML = P.renderGoalsPane(replay);
    body.querySelector('[data-pane="runs"]').innerHTML = P.renderRunsPane(replay);
    body.querySelector('[data-pane="evidence"]').innerHTML = P.renderEvidencePane(replay);
  }

  // ── Create overlay ────────────────────────────────────────────────────
  async function openCreate() {
    state.formState = window.CampaignForm.DEFAULT_STATE();
    const refs = await ensureRefs();
    $('campaign-create-bd').innerHTML = window.CampaignForm.render(state.formState, refs);
    $('campaign-create-feedback').textContent = '';
    $('campaign-create-overlay').classList.remove('hidden');
    requestAnimationFrame(() => {
      $('cf-title')?.focus();
      $('campaign-create-overlay').classList.add('open');
    });
  }

  function closeCreate() {
    $('campaign-create-overlay').classList.remove('open');
    setTimeout(() => $('campaign-create-overlay').classList.add('hidden'), 180);
  }

  function rerenderForm() {
    $('campaign-create-bd').innerHTML = window.CampaignForm.render(state.formState, state.refs || {});
  }

  function refreshPromptPreview() {
    const preview = $('cf-prompt-preview');
    if (preview && state.refs) {
      preview.textContent = window.CampaignForm.generatePromptPreview(state.formState, state.refs);
    }
  }

  // ── Form events ───────────────────────────────────────────────────────
  function bindCreateEvents() {
    const overlay = $('campaign-create-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target.matches('[data-create-close]')) closeCreate();
    });

    // Field input → state mutation. Most inputs use data-cf="path"; the
    // chip-picker + segmented + risk-grid have their own data-attrs.
    overlay.addEventListener('input', (e) => {
      const path = e.target.dataset?.cf;
      if (!path || !state.formState) return;
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      window.CampaignForm.setField(state.formState, path, value);
      refreshPromptPreview();
    });

    overlay.addEventListener('change', (e) => {
      const path = e.target.dataset?.cf;
      if (path && e.target.type === 'checkbox') {
        window.CampaignForm.setField(state.formState, path, e.target.checked);
        refreshPromptPreview();
      }
      const riskId = e.target.dataset?.cfRisk;
      if (riskId) {
        const allowed = new Set(state.formState.riskBudget.allowedRiskClasses);
        const blocked = new Set(state.formState.riskBudget.blockedRiskClasses);
        if (e.target.checked) { allowed.add(riskId); blocked.delete(riskId); }
        else { allowed.delete(riskId); blocked.add(riskId); }
        state.formState.riskBudget.allowedRiskClasses = [...allowed];
        state.formState.riskBudget.blockedRiskClasses = [...blocked];
        rerenderForm();
      }
    });

    overlay.addEventListener('click', (e) => {
      // Toolpack chip
      const chip = e.target.closest('[data-cf-chip]');
      if (chip && state.formState) {
        e.preventDefault();
        const id = chip.dataset.cfChip;
        const tps = new Set(state.formState.toolpackIds);
        if (tps.has(id)) tps.delete(id); else tps.add(id);
        state.formState.toolpackIds = [...tps];
        rerenderForm();
        return;
      }
      // Segmented (backend)
      const seg = e.target.closest('[data-cf-segmented]');
      if (seg && !seg.disabled && state.formState) {
        e.preventDefault();
        state.formState.backend = seg.dataset.value;
        rerenderForm();
        return;
      }
    });

    $('campaign-create-submit').addEventListener('click', async () => {
      const fb = $('campaign-create-feedback');
      fb.textContent = '';
      fb.className = 'test-result';
      const v = window.CampaignForm.validate(state.formState);
      if (!v.ok) {
        const first = Object.values(v.errors)[0];
        fb.textContent = `✗ ${first}`;
        fb.className = 'test-result error';
        rerenderForm();
        return;
      }
      const body = window.CampaignForm.toCreatePayload(state.formState);
      const btn = $('campaign-create-submit');
      btn.disabled = true;
      try {
        const created = await window.CampaignClient.create(body);
        fb.textContent = '✓ created';
        fb.className = 'test-result success';
        await paintList();
        closeCreate();
        openDetail(created.id);
      } catch (err) {
        fb.textContent = `✗ ${err.message}`;
        fb.className = 'test-result error';
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ── List + detail events ──────────────────────────────────────────────
  function bindListEvents() {
    const list = $('campaigns-list');
    list?.addEventListener('click', (e) => {
      const row = e.target.closest('.campaign-row');
      if (!row) return;
      openDetail(row.dataset.campaignId);
    });
    list?.addEventListener('keydown', (e) => {
      const row = e.target.closest('.campaign-row');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(row.dataset.campaignId);
      }
    });
  }

  function bindDrawerEvents() {
    const drawer = $('campaign-detail-drawer');
    drawer?.addEventListener('click', async (e) => {
      // Tab switching
      const tab = e.target.closest('.drawer-tab');
      if (tab && tab.dataset.tab) {
        drawer.querySelectorAll('.drawer-tab').forEach((t) => t.classList.toggle('active', t === tab));
        drawer.querySelectorAll('.drawer-pane').forEach((p) => {
          p.hidden = p.dataset.pane !== tab.dataset.tab;
        });
        return;
      }
      // Lifecycle / evidence actions
      const actionBtn = e.target.closest('[data-campaign-action]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.campaignAction;
      const id = state.selectedId;
      if (!id) return;
      actionBtn.disabled = true;
      try {
        let nextDetail = true;
        if (action === 'start')      await window.CampaignClient.start(id);
        else if (action === 'pause') await window.CampaignClient.pause(id);
        else if (action === 'resume')await window.CampaignClient.resume(id);
        else if (action === 'cancel'){
          if (!confirm('Cancel this campaign? Queued goals become skipped.')) { nextDetail = false; }
          else await window.CampaignClient.cancel(id);
        }
        else if (action === 'run-next') await window.CampaignClient.runNext(id);
        else if (action === 'report') {
          const fb = $('campaign-evidence-feedback');
          const art = await window.CampaignClient.report(id);
          fb.textContent = `✓ report artifact ${art.id}`;
          fb.className = 'test-result success';
        }
        else if (action === 'evidence') {
          const fb = $('campaign-evidence-feedback');
          const art = await window.CampaignClient.evidence(id);
          fb.textContent = `✓ evidence bundle ${art.id} · ${art.title}`;
          fb.className = 'test-result success';
        }
        if (nextDetail) { await paintList(); await openDetail(id); }
      } catch (err) {
        const fb = $('campaign-evidence-feedback');
        if (fb && (action === 'report' || action === 'evidence')) {
          fb.textContent = `✗ ${err.message}`;
          fb.className = 'test-result error';
        } else {
          alert(`Campaign action failed: ${err.message}`);
        }
      } finally {
        actionBtn.disabled = false;
      }
    });
  }

  // ── Public surface ────────────────────────────────────────────────────
  window.CampaignsPage = {
    init() {
      $('refresh-campaigns-btn')?.addEventListener('click', () => paintList());
      $('new-campaign-btn')?.addEventListener('click', () => openCreate());
      bindCreateEvents();
      bindListEvents();
      bindDrawerEvents();
    },
    show() { paintList(); ensureRefs(); },
    paint: paintList,
    openDetail, closeDetail, openCreate, closeCreate,
  };
})();
