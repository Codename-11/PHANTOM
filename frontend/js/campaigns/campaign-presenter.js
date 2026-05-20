// Pure presenter for the Campaigns page. Renders campaign list HTML
// from API data; no DOM listeners, no fetch — those live in the page
// wrapper. Kept pure so it can be unit-tested with a minimal DOM stub.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusChip(status) {
    return `<span class="campaign-pill campaign-pill-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  }

  function renderRow(c) {
    const tp = (c.toolpack_ids || []).join(', ') || '—';
    const budget = c.run_budget || {};
    return `
      <li class="campaign-row" data-campaign-id="${escapeHtml(c.id)}">
        <div class="campaign-row-head">
          ${statusChip(c.status)}
          <span class="campaign-row-title">${escapeHtml(c.title)}</span>
        </div>
        <div class="campaign-row-objective">${escapeHtml((c.objective || '').slice(0, 200))}${(c.objective || '').length > 200 ? '…' : ''}</div>
        <div class="campaign-row-meta">
          <span class="campaign-meta-item">backend: ${escapeHtml(c.worker_backend || 'phantom-native')}</span>
          <span class="campaign-meta-item">toolpacks: ${escapeHtml(tp)}</span>
          <span class="campaign-meta-item">runs cap: ${escapeHtml(String(budget.maxChildRuns ?? '—'))}</span>
          <span class="campaign-meta-item">attempts/goal: ${escapeHtml(String(budget.maxAttemptsPerGoal ?? '—'))}</span>
        </div>
      </li>
    `;
  }

  function renderList(campaigns) {
    if (!Array.isArray(campaigns) || !campaigns.length) {
      return `<div class="campaigns-empty">No campaigns yet. Create one via <code>POST /api/campaigns</code> — the inline creation form lands in a follow-up task.</div>`;
    }
    return `<ul class="campaigns-rows">${campaigns.map(renderRow).join('')}</ul>`;
  }

  // Exported so the page wrapper + tests can call it.
  window.CampaignPresenter = {
    renderList,
    renderRow,
    statusChip,
  };
})();
