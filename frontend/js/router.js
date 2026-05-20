window.Router = {
  current: 'dash',
  defaultRoute: 'dash',
  // Routes we don't want to "stick" — landing on Dash is always preferable
  // to landing on Settings after a reload.
  noRestore: new Set(['settings']),
  storeKey: 'phantom:last-route',
  routes: ['dash', 'chat', 'runs', 'graph', 'alerts', 'artifacts', 'approvals', 'scope', 'campaigns', 'settings'],

  init() {
    this.chatArea = document.getElementById('chat-area');
    this.inputArea = document.getElementById('input-area');
    this.pageContainer = document.getElementById('page-container');
    this.pages = Array.from(document.querySelectorAll('[data-page]'));

    document.querySelectorAll('[data-route]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        this.navigate(el.dataset.route);
      });
    });

    // Priority: explicit URL hash → persisted last route → default (Dash).
    // First-time visitors and operators returning after closing Settings
    // both land on Dash; everyone else picks up where they left off.
    const hashRoute = window.location.hash.replace('#', '');
    let restored = null;
    try { restored = localStorage.getItem(this.storeKey); } catch { /* private mode */ }
    const initialRoute = hashRoute
      || (restored && this.routes.includes(restored) && !this.noRestore.has(restored) ? restored : this.defaultRoute);
    this.navigate(initialRoute, { replace: true });
  },

  navigate(route, { replace = false } = {}) {
    if (!this.routes.includes(route)) route = this.defaultRoute;
    this.current = route;
    if (!this.noRestore.has(route)) {
      try { localStorage.setItem(this.storeKey, route); } catch { /* ignore */ }
    }

    const isChat = route === 'chat';
    this.chatArea?.classList.toggle('hidden', !isChat);
    this.inputArea?.classList.toggle('hidden', !isChat);
    this.pageContainer?.classList.toggle('hidden', isChat);

    this.pages.forEach((page) => {
      page.classList.toggle('active', page.dataset.page === route);
    });

    document.querySelectorAll('[data-route]').forEach((el) => {
      el.classList.toggle('active', el.dataset.route === route);
    });

    if (!replace) {
      const hash = `#${route}`;
      if (window.location.hash !== hash) window.history.pushState({ route }, '', hash);
    }

    // Page-specific show hooks
    if (route === 'dash') {
      window.Dash?.show?.();
      window.DiagnosticsCard?.show?.('dash');
      window.OnboardingChecklist?.show?.();
    }
    if (route === 'approvals') window.ApprovalsPage?.show?.();
    if (route === 'campaigns') window.CampaignsPage?.show?.();
    if (route === 'settings') window.DiagnosticsCard?.show?.('settings');

    window.dispatchEvent(new CustomEvent('phantom:route', { detail: { route } }));
  },
};

window.addEventListener('popstate', () => {
  const route = window.location.hash.replace('#', '') || window.Router.defaultRoute;
  window.Router.navigate(route, { replace: true });
});
