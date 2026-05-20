// Registry page (B2). List + detail glue over /api/registry/local.
// Read-only — write paths (import/enable/install/rollback) thread
// through Approvals in a follow-up.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = { list: null, selectedId: null, detail: null, preview: null };

  async function loadList() {
    return window.apiFetch('/api/registry/local', { timeoutMs: 3000 });
  }
  async function loadDetail(id) {
    return window.apiFetch(`/api/registry/local/${encodeURIComponent(id)}`, { timeoutMs: 3000 });
  }
  async function loadPreview(id) {
    return window.apiFetch(`/api/registry/local/${encodeURIComponent(id)}/preview-install`, {
      method: 'POST', body: JSON.stringify({}), timeoutMs: 3000,
    });
  }

  async function paintList() {
    const host = $('registry-list');
    if (!host) return;
    host.innerHTML = window.DataState.renderLoading('Loading registry…');
    try {
      const payload = await loadList();
      state.list = payload;
      host.innerHTML = window.RegistryPresenter.renderList(payload);
      host.setAttribute('data-empty', String(!payload.manifests?.length));
    } catch (err) {
      host.innerHTML = window.DataState.renderError({ err, retryAction: 'registry-list' });
    }
  }

  async function paintDetail(id) {
    state.selectedId = id;
    document.querySelectorAll('.registry-row').forEach((el) => {
      el.classList.toggle('selected', el.dataset.manifestId === id);
    });
    const drawer = $('registry-detail');
    if (!drawer) return;
    drawer.classList.remove('hidden');
    const body = $('registry-detail-body');
    body.innerHTML = window.DataState.renderLoading('Loading manifest…');

    try {
      const manifest = await loadDetail(id);
      state.detail = manifest;
      const header = window.RegistryPresenter.renderHeader(manifest);
      $('registry-detail-title').textContent = header.title;
      $('registry-detail-summary').textContent = header.summary;
      $('registry-detail-id').textContent = `${header.id} · v${header.version}`;
      const pill = $('registry-detail-pill');
      pill.className = header.pill;
      pill.textContent = header.pillText;

      // Preview install plan in parallel
      let preview = null;
      try { preview = await loadPreview(id); }
      catch { preview = null; }
      state.preview = preview;

      body.innerHTML = window.RegistryPresenter.renderDetail(manifest, preview);
    } catch (err) {
      body.innerHTML = window.DataState.renderError({ err, retryAction: `registry-detail:${id}` });
    }
  }

  function bindListEvents() {
    const host = $('registry-list');
    host?.addEventListener('click', (e) => {
      const row = e.target.closest('.registry-row');
      if (!row) return;
      paintDetail(row.dataset.manifestId);
    });
    host?.addEventListener('keydown', (e) => {
      const row = e.target.closest('.registry-row');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        paintDetail(row.dataset.manifestId);
      }
    });
  }

  window.RegistryPage = {
    init() {
      $('refresh-registry-btn')?.addEventListener('click', () => paintList());
      bindListEvents();
    },
    show() { paintList(); },
    paint: paintList,
    paintDetail,
  };
})();
