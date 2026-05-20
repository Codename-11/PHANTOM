// Dash onboarding checklist (A1).
//
// Mounts at #onboarding-checklist. Five rows derived from
// /api/onboarding/status. Each unchecked row is a button that either
// navigates to the relevant page or calls the matching onboarding
// action. The whole section auto-hides when `complete:true`.

(function () {
  'use strict';

  const ITEMS = [
    {
      id: 'demoLoaded',
      title: 'Load a demo scenario',
      help: 'Quickest path to see PHANTOM populated — synthetic scopes/assets/runs/findings.',
      ctaLabel: 'Load demo',
      ctaAction: 'load-demo',
    },
    {
      id: 'toolpacksInstalled',
      title: 'Install starter toolpacks',
      help: 'Toolpacks bundle the curated security tools PHANTOM gates and traces.',
      ctaLabel: 'Open Settings',
      ctaRoute: 'settings',
    },
    {
      id: 'hasScope',
      title: 'Authorize a scope',
      help: 'A scope bounds what targets PHANTOM may touch and which risk classes are allowed.',
      ctaLabel: 'Draft scope',
      ctaRoute: 'scope',
    },
    {
      id: 'hasAsset',
      title: 'Add an asset',
      help: 'Inventory the hosts/services in-scope. Future: scan your LAN to populate this.',
      ctaLabel: 'Open Assets',
      ctaRoute: 'scope',
    },
    {
      id: 'hasRun',
      title: 'Run a governed task',
      help: 'Either start a chat in a scope, or open Campaigns and launch a first goal.',
      ctaLabel: 'Open Campaigns',
      ctaRoute: 'campaigns',
    },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderRow(item, checked) {
    return `
      <li class="onb-row ${checked ? 'on' : ''}" data-onb-id="${esc(item.id)}">
        <span class="onb-check" aria-hidden="true">${checked ? '✓' : ''}</span>
        <div class="onb-body">
          <p class="onb-title">${esc(item.title)}</p>
          <p class="onb-help">${esc(item.help)}</p>
        </div>
        <div class="onb-action">
          ${checked
            ? `<span class="onb-done">Done</span>`
            : `<button class="btn primary sm" type="button"
                ${item.ctaAction ? `data-onb-action="${esc(item.ctaAction)}"` : ''}
                ${item.ctaRoute ? `data-onb-route="${esc(item.ctaRoute)}"` : ''}>${esc(item.ctaLabel)}</button>`}
        </div>
      </li>
    `;
  }

  function render(host, status) {
    const checklist = status?.checklist || {};
    if (status?.complete) {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const unchecked = ITEMS.filter((i) => !checklist[i.id]).length;
    host.innerHTML = `
      <div class="onb-card">
        <header class="onb-card-hd">
          <p class="onb-eyebrow">Get started</p>
          <h2 class="onb-title-main">Finish PHANTOM setup</h2>
          <p class="onb-sub">${esc(unchecked)} of ${ITEMS.length} steps left.</p>
          <button class="btn ghost sm" data-onb-action="dismiss" title="Hide until next reload">Hide</button>
        </header>
        <ul class="onb-list">${ITEMS.map((item) => renderRow(item, !!checklist[item.id])).join('')}</ul>
        <footer class="onb-card-ft">
          <span class="cf-hint">Already loaded demo? <button class="inline-link" data-onb-action="clear-demo">Clear demo data</button></span>
        </footer>
      </div>
    `;
  }

  async function load() {
    try { return await window.apiFetch('/api/onboarding/checklist', { timeoutMs: 3000 }); }
    catch (err) { return { __error: err }; }
  }

  async function paint() {
    const host = document.getElementById('onboarding-checklist');
    if (!host) return;
    const status = await load();
    if (status.__error) {
      // Quietly hide on error — it's a nice-to-have surface, not a load-bearing one.
      host.hidden = true;
      return;
    }
    render(host, status);
  }

  async function loadDemo({ reset = false } = {}) {
    return window.apiFetch('/api/onboarding/load-demo', {
      method: 'POST', body: JSON.stringify({ reset }), timeoutMs: 15000,
    });
  }

  async function clearDemoCall() {
    return window.apiFetch('/api/onboarding/clear-demo', {
      method: 'POST', body: JSON.stringify({}), timeoutMs: 8000,
    });
  }

  function bind() {
    const host = document.getElementById('onboarding-checklist');
    if (!host) return;
    host.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-onb-action]')?.dataset.onbAction;
      const route  = e.target.closest('[data-onb-route]')?.dataset.onbRoute;
      const btn = e.target.closest('button');
      if (action === 'dismiss') {
        host.hidden = true;
        return;
      }
      if (route) {
        window.Router?.navigate?.(route);
        return;
      }
      if (action === 'load-demo') {
        if (btn) btn.disabled = true;
        try {
          await loadDemo({});
          await paint();
          window.location.reload();
        } catch (err) {
          if (err.status === 409 && confirm('Demo data is already present. Reset and reseed?')) {
            try { await loadDemo({ reset: true }); window.location.reload(); }
            catch (e2) { alert(`Load demo failed: ${e2.message}`); }
          } else {
            alert(`Load demo failed: ${err.message}`);
          }
        } finally {
          if (btn) btn.disabled = false;
        }
        return;
      }
      if (action === 'clear-demo') {
        if (!confirm('Clear all [demo]-tagged rows? This cannot be undone.')) return;
        try { await clearDemoCall(); window.location.reload(); }
        catch (err) { alert(`Clear demo failed: ${err.message}`); }
        return;
      }
    });
  }

  window.OnboardingChecklist = {
    init() { bind(); paint(); },
    show() { paint(); },
    refresh: paint,
  };
})();
