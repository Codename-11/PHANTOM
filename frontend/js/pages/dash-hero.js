// A5 — Dash next-action hero.
//
// Mounts at #dash-hero. Surfaces ONE primary action derived from
// current PHANTOM state. Priority order (first match wins):
//   1. Diagnostics overall = blocked → "Fix [first blocked check]"
//   2. Onboarding incomplete           → "Continue setup"
//   3. Pending approvals > 0           → "Review N approvals"
//   4. Active campaign exists          → "Continue [campaign]"
//   5. Else                            → "Start a new campaign"
//
// Also surfaces a "Continue where you left off" pill that opens the
// most-recent conversation (kept in localStorage). All state is
// fetched via apiFetch with short timeouts; partial failures degrade
// to the next priority level rather than failing the hero.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function tryFetch(url, fallback, timeoutMs = 1500) {
    try { return await window.apiFetch(url, { timeoutMs }); }
    catch { return fallback; }
  }

  async function fetchHeroState() {
    const [diag, checklist, campaigns, approvals] = await Promise.all([
      tryFetch('/api/diagnostics', null, 1700),
      tryFetch('/api/onboarding/checklist', null, 1200),
      tryFetch('/api/campaigns', { campaigns: [] }, 1200),
      tryFetch('/api/approvals', [], 1200),
    ]);
    return { diag, checklist, campaigns: campaigns.campaigns || [], approvals: Array.isArray(approvals) ? approvals : (approvals?.approvals || []) };
  }

  function deriveAction({ diag, checklist, campaigns, approvals }) {
    // Priority 1: blocked diagnostic check
    if (diag?.overall === 'blocked') {
      const blocked = (diag.checks || []).find((c) => c.status === 'blocked');
      return {
        eyebrow: 'System blocked',
        title: blocked ? `Fix ${blocked.id}` : 'Fix system error',
        body: blocked?.detail || 'A core check is failing. Open diagnostics to inspect.',
        ctaLabel: 'Open diagnostics',
        ctaRoute: 'settings',
        tone: 'crit',
      };
    }

    // Priority 2: onboarding incomplete (only when we actually have a checklist)
    if (checklist && !checklist.complete) {
      const cl = checklist.checklist || {};
      const next = !cl.demoLoaded ? 'Load demo scenario'
        : !cl.toolpacksInstalled ? 'Install starter toolpacks'
        : !cl.hasScope ? 'Authorize a scope'
        : !cl.hasAsset ? 'Add an asset'
        : !cl.hasRun ? 'Run a governed task'
        : 'Finish setup';
      return {
        eyebrow: 'Get started',
        title: next,
        body: 'PHANTOM isn’t set up yet. The Dash checklist below walks you through what’s left.',
        ctaLabel: 'See checklist',
        ctaScroll: 'onboarding-checklist',
        tone: 'cy',
      };
    }

    // Priority 3: pending approvals
    const pending = approvals.filter((a) => (a.status || 'pending') === 'pending');
    if (pending.length > 0) {
      return {
        eyebrow: 'Awaiting your decision',
        title: `Review ${pending.length} approval${pending.length === 1 ? '' : 's'}`,
        body: 'High-risk actions are paused for your decision.',
        ctaLabel: 'Open approvals',
        ctaRoute: 'approvals',
        tone: 'warn',
      };
    }

    // Priority 4: active campaign
    const active = campaigns.find((c) => c.status === 'running')
      || campaigns.find((c) => c.status === 'needs_approval')
      || campaigns.find((c) => c.status === 'paused');
    if (active) {
      return {
        eyebrow: 'Active campaign',
        title: `Continue ${active.title}`,
        body: active.objective ? active.objective.slice(0, 160) : '',
        ctaLabel: 'Open campaign',
        ctaRoute: 'campaigns',
        tone: 'cy',
      };
    }

    // Priority 5: default — start a new campaign
    return {
      eyebrow: 'Ready',
      title: 'Start a new campaign',
      body: 'Campaigns scope a governed multi-run objective. The supervisor owns budgets, policy, and evidence.',
      ctaLabel: 'New campaign',
      ctaRoute: 'campaigns',
      tone: 'cy',
    };
  }

  function readContinueWhereLeftOff() {
    try {
      const raw = localStorage.getItem('phantom_last_seen');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.kind || !parsed.id || !parsed.label) return null;
      return parsed; // { kind: 'conversation'|'campaign'|'run', id, label, route }
    } catch { return null; }
  }

  function render(host, action, continueCard) {
    host.innerHTML = `
      <article class="dash-hero" data-tone="${esc(action.tone)}">
        <div class="dash-hero-body">
          <p class="dash-hero-eyebrow">${esc(action.eyebrow)}</p>
          <h2 class="dash-hero-title">${esc(action.title)}</h2>
          ${action.body ? `<p class="dash-hero-help">${esc(action.body)}</p>` : ''}
        </div>
        <div class="dash-hero-actions">
          <button class="btn primary sm" data-hero-action="primary"
            ${action.ctaRoute ? `data-hero-route="${esc(action.ctaRoute)}"` : ''}
            ${action.ctaScroll ? `data-hero-scroll="${esc(action.ctaScroll)}"` : ''}>
            ${esc(action.ctaLabel)}
          </button>
        </div>
        ${continueCard ? `
          <div class="dash-hero-continue">
            <span class="dash-hero-continue-lbl">Continue where you left off:</span>
            <button class="btn ghost sm" data-hero-action="continue"
              data-hero-route="${esc(continueCard.route || 'chat')}"
              data-continue-id="${esc(continueCard.id)}">
              ${esc(continueCard.label)}
            </button>
          </div>` : ''}
      </article>
    `;
  }

  function bind(host) {
    host.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hero-action]');
      if (!btn) return;
      const route = btn.dataset.heroRoute;
      const scroll = btn.dataset.heroScroll;
      if (route) window.Router?.navigate?.(route);
      if (scroll) {
        const target = document.getElementById(scroll);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  let _bound = false;
  async function paint() {
    const host = $('dash-hero');
    if (!host) return;
    if (!_bound) { bind(host); _bound = true; }
    host.innerHTML = window.DataState.renderLoading('Loading…');
    const state = await fetchHeroState();
    const action = deriveAction(state);
    const continueCard = readContinueWhereLeftOff();
    render(host, action, continueCard);
  }

  window.DashHero = {
    init() { paint(); },
    show() { paint(); },
    paint,
    deriveAction, // exported for tests
  };
})();
