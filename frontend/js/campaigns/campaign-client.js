// Campaign client — thin fetch wrapper. Keeps all networking calls in
// one place so the page wrapper stays focused on DOM/event glue. All
// calls return parsed JSON, throwing on non-2xx so callers can rely on
// try/catch for failure paths.

(function () {
  'use strict';

  async function req(url, opts = {}) {
    const headers = opts.body ? { 'Content-Type': 'application/json' } : {};
    const res = await fetch(url, { headers, ...opts });
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
    return body;
  }

  const C = {
    list:        ()      => req('/api/campaigns').then((d) => d.campaigns || []),
    backends:    ()      => req('/api/campaigns/backends').then((d) => d.backends || []),
    scopes:      ()      => req('/api/scopes').then((d) => d.scopes || d || []),
    profiles:    ()      => req('/api/prompts/profiles').then((d) => d.profiles || d || []),
    toolpacks:   ()      => req('/api/toolpacks').then((d) => d.toolpacks || d || []),
    create:      (body)  => req('/api/campaigns', { method: 'POST', body: JSON.stringify(body) })
                              .then((d) => d.campaign),
    get:         (id)    => req(`/api/campaigns/${id}`),
    replay:      (id)    => req(`/api/campaigns/${id}/replay`),
    update:      (id, b) => req(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    addGoal:     (id, b) => req(`/api/campaigns/${id}/goals`, { method: 'POST', body: JSON.stringify(b) }),
    runNext:     (id)    => req(`/api/campaigns/${id}/run-next`, { method: 'POST' }),
    start:       (id)    => req(`/api/campaigns/${id}/start`,   { method: 'POST', body: '{}' }),
    pause:       (id)    => req(`/api/campaigns/${id}/pause`,   { method: 'POST', body: '{}' }),
    resume:      (id)    => req(`/api/campaigns/${id}/resume`,  { method: 'POST', body: '{}' }),
    cancel:      (id)    => req(`/api/campaigns/${id}/cancel`,  { method: 'POST', body: '{}' }),
    report:      (id)    => req(`/api/campaigns/${id}/artifacts/report`, { method: 'POST', body: '{}' }),
    evidence:    (id)    => req(`/api/campaigns/${id}/artifacts/evidence-bundle`, { method: 'POST', body: '{}' }),
  };

  window.CampaignClient = C;
})();
