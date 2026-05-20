// Campaigns page wrapper — fetch + paint glue. The pure render lives in
// frontend/js/campaigns/campaign-presenter.js so it can be unit-tested
// against a tiny DOM stub.
//
// v1 is read-only: list campaigns + refresh. The creation form, detail
// drill-in, and lifecycle controls land in follow-up tasks (Task 5,
// Task 9 per docs/plans/2026-05-20-phantom-goal-engine-plan.md).

(function () {
  'use strict';

  async function fetchCampaigns() {
    try {
      const res = await fetch('/api/campaigns');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.campaigns) ? data.campaigns : [];
    } catch {
      return [];
    }
  }

  async function paint() {
    const host = document.getElementById('campaigns-list');
    if (!host) return;
    const campaigns = await fetchCampaigns();
    host.innerHTML = window.CampaignPresenter
      ? window.CampaignPresenter.renderList(campaigns)
      : '';
    host.setAttribute('data-empty', String(!campaigns.length));
  }

  window.CampaignsPage = {
    init() {
      const refresh = document.getElementById('refresh-campaigns-btn');
      if (refresh) refresh.addEventListener('click', () => paint());
    },
    show() { paint(); },
    paint,
  };
})();
