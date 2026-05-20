// Dash + Settings diagnostics card.
//
// Mounts in two places:
//   - #dash-diagnostics-card (compact, top of Dash)
//   - #settings-diagnostics-card (full, on Settings page)
//
// Both surfaces share the same render path; the Settings variant adds a
// "Copy as JSON" affordance and surfaces every check row by id.

(function () {
  'use strict';

  const STATUS_LABEL = {
    ok: 'Ready',
    needs_setup: 'Needs setup',
    degraded: 'Degraded',
    blocked: 'Blocked',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderRow(check) {
    return `
      <li class="diag-row" data-status="${esc(check.status)}">
        <span class="diag-dot" data-status="${esc(check.status)}" aria-hidden="true"></span>
        <span class="diag-id">${esc(check.id)}</span>
        <span class="diag-detail">${esc(check.detail || '')}</span>
        <span class="diag-elapsed mono">${esc(check.elapsedMs)}ms</span>
      </li>
    `;
  }

  function renderCompact(result, retryLabel = 'Refresh') {
    if (!result) return window.DataState.renderLoading('Checking system readiness…');
    const overall = result.overall || 'blocked';
    const headline = STATUS_LABEL[overall] || overall;
    const failing = (result.checks || []).filter((c) => c.status !== 'ok');
    return `
      <div class="diag-card diag-${esc(overall)}">
        <div class="diag-card-hd">
          <span class="diag-dot diag-dot-lg" data-status="${esc(overall)}" aria-hidden="true"></span>
          <span class="diag-overall">${esc(headline)}</span>
          <span class="grow"></span>
          <button class="btn ghost sm" data-diag-action="refresh">${esc(retryLabel)}</button>
        </div>
        ${failing.length
          ? `<ul class="diag-rows">${failing.slice(0, 4).map(renderRow).join('')}</ul>`
          : `<div class="diag-ok">All systems ready. ${esc(result.checks?.length || 0)} checks, ${esc(result.elapsedMs)}ms.</div>`}
      </div>
    `;
  }

  function renderFull(result) {
    if (!result) return window.DataState.renderLoading('Loading diagnostics…');
    const overall = result.overall || 'blocked';
    return `
      <div class="diag-card diag-full diag-${esc(overall)}">
        <div class="diag-card-hd">
          <span class="diag-dot diag-dot-lg" data-status="${esc(overall)}"></span>
          <span class="diag-overall">${esc(STATUS_LABEL[overall] || overall)}</span>
          <span class="grow"></span>
          <button class="btn ghost sm" data-diag-action="copy">Copy as JSON</button>
          <button class="btn ghost sm" data-diag-action="refresh">↻ Refresh</button>
        </div>
        <ul class="diag-rows">${(result.checks || []).map(renderRow).join('')}</ul>
        <p class="diag-meta mono">generated ${esc(result.generatedAt)} · ${esc(result.elapsedMs)}ms</p>
      </div>
    `;
  }

  async function load() {
    try {
      return await window.apiFetch('/api/diagnostics', { timeoutMs: 4000 });
    } catch (err) {
      return { __error: err };
    }
  }

  function paint(hostId, mode = 'compact') {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = window.DataState.renderLoading('Checking system readiness…');
    load().then((result) => {
      if (!document.getElementById(hostId)) return;
      if (result.__error) {
        host.innerHTML = window.DataState.renderError({ err: result.__error, retryAction: `diag:${hostId}` });
        return;
      }
      host.innerHTML = mode === 'full' ? renderFull(result) : renderCompact(result);
      host.dataset.overall = result.overall;
    });
  }

  function bind(hostId, mode) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.addEventListener('click', (e) => {
      const action = e.target.closest('[data-diag-action]')?.dataset.diagAction;
      if (action === 'refresh') paint(hostId, mode);
      else if (action === 'copy') {
        load().then((result) => {
          if (result.__error) return;
          navigator.clipboard?.writeText(JSON.stringify(result, null, 2));
        });
      }
      const retry = e.target.closest('[data-ds-retry]')?.dataset.dsRetry;
      if (retry && retry === `diag:${hostId}`) paint(hostId, mode);
    });
  }

  window.DiagnosticsCard = {
    init() {
      bind('dash-diagnostics-card', 'compact');
      bind('settings-diagnostics-card', 'full');
    },
    show(which = 'dash') {
      if (which === 'dash')     paint('dash-diagnostics-card', 'compact');
      else if (which === 'settings') paint('settings-diagnostics-card', 'full');
    },
    refresh(which) { this.show(which); },
    renderCompact, renderFull, // exposed for tests
  };
})();
