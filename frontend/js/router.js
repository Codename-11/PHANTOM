window.Router = {
  current: 'dash',
  defaultRoute: 'dash',
  routes: ['dash', 'chat', 'runs', 'graph', 'alerts', 'artifacts', 'scope', 'settings'],

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

    const initialRoute = window.location.hash.replace('#', '') || this.defaultRoute;
    this.navigate(initialRoute, { replace: true });
  },

  navigate(route, { replace = false } = {}) {
    if (!this.routes.includes(route)) route = this.defaultRoute;
    this.current = route;

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
    if (route === 'dash') window.Dash?.show?.();

    window.dispatchEvent(new CustomEvent('phantom:route', { detail: { route } }));
  },
};

window.addEventListener('popstate', () => {
  const route = window.location.hash.replace('#', '') || window.Router.defaultRoute;
  window.Router.navigate(route, { replace: true });
});
