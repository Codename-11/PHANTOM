window.Router = {
  current: 'chat',
  routes: ['chat', 'runs', 'graph', 'artifacts', 'scope', 'settings'],

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

    const initialRoute = window.location.hash.replace('#', '') || 'chat';
    this.navigate(initialRoute, { replace: true });
  },

  navigate(route, { replace = false } = {}) {
    if (!this.routes.includes(route)) route = 'chat';
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
      const hash = route === 'chat' ? '#chat' : `#${route}`;
      if (window.location.hash !== hash) window.history.pushState({ route }, '', hash);
    }

    window.dispatchEvent(new CustomEvent('phantom:route', { detail: { route } }));
  },
};

window.addEventListener('popstate', () => {
  const route = window.location.hash.replace('#', '') || 'chat';
  window.Router.navigate(route, { replace: true });
});
