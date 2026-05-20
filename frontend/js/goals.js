/**
 * Goals — frontend glue.
 *
 * Two surfaces:
 *   - Top-bar #active-goal-strip — mirrors the scope-strip style.
 *     Shows the active goal title + linked-run count. Hidden when no
 *     goal is active. Clicking routes to Settings → Goals.
 *   - Settings → Goals card (#settings-goals) — CRUD list + create
 *     form. Activate / complete / delete inline.
 *
 * Calls /api/goals — see docs/plans/2026-05-20-phantom-goal-engine-plan.md.
 */
(function () {
  'use strict';

  const API = '/api/goals';

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, {
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      ...opts,
    });
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
    return body;
  }

  // ── Banner ────────────────────────────────────────────────────────────────

  function paintBanner(goal, linkedRunCount) {
    const strip = el('active-goal-strip');
    if (!strip) return;
    if (!goal) {
      strip.hidden = true;
      strip.setAttribute('data-empty', 'true');
      return;
    }
    strip.hidden = false;
    strip.removeAttribute('data-empty');
    strip.querySelector('.name').textContent = goal.title;
    const meta = strip.querySelector('.meta');
    const parts = [goal.status];
    if (typeof linkedRunCount === 'number') parts.push(`${linkedRunCount} run${linkedRunCount === 1 ? '' : 's'}`);
    if (goal.satisfied_at) parts.push('claim filed');
    meta.textContent = parts.join(' · ');
  }

  async function refreshBanner() {
    try {
      const { goal } = await fetchJSON(`${API}/current`);
      if (!goal) return paintBanner(null);
      // Pull the count cheaply via the detail endpoint
      const detail = await fetchJSON(`${API}/${goal.id}`);
      paintBanner(detail.goal, detail.linkedRunCount);
    } catch {
      paintBanner(null);
    }
  }

  // ── Settings → Goals card ────────────────────────────────────────────────

  function renderListItem(goal, currentId) {
    const isCurrent = goal.id === currentId;
    const pillClass = isCurrent ? 'goal-pill goal-pill-active' : `goal-pill goal-pill-${goal.status}`;
    return `
      <li class="goal-row" data-goal-id="${escapeHtml(goal.id)}">
        <div class="goal-row-head">
          <span class="${pillClass}">${escapeHtml(goal.status)}${isCurrent ? ' · active' : ''}</span>
          <span class="goal-row-title">${escapeHtml(goal.title)}</span>
        </div>
        <div class="goal-row-objective">${escapeHtml((goal.objective || '').slice(0, 200))}${(goal.objective || '').length > 200 ? '…' : ''}</div>
        <div class="goal-row-actions">
          ${isCurrent
            ? `<button class="btn btn-secondary" data-goal-action="clear">Clear active</button>`
            : (goal.status === 'active'
                ? `<button class="btn btn-primary" data-goal-action="activate">Activate</button>`
                : '')}
          ${goal.status === 'active' ? `<button class="btn btn-secondary" data-goal-action="complete">Mark complete</button>` : ''}
          <button class="btn btn-danger" data-goal-action="delete">Delete</button>
        </div>
      </li>
    `;
  }

  async function refreshList() {
    const list = el('goals-list');
    if (!list) return;
    try {
      const [{ goals }, { goal: current }] = await Promise.all([
        fetchJSON(`${API}?status=all`),
        fetchJSON(`${API}/current`),
      ]);
      if (!goals.length) {
        list.innerHTML = `<li class="goals-empty">No goals yet — create one above.</li>`;
        list.setAttribute('data-empty', 'true');
      } else {
        const currentId = current ? current.id : null;
        list.innerHTML = goals.map((g) => renderListItem(g, currentId)).join('');
        list.removeAttribute('data-empty');
      }
    } catch (err) {
      list.innerHTML = `<li class="goals-empty">Failed to load goals: ${escapeHtml(err.message)}</li>`;
    }
  }

  function bindCreateForm() {
    const btn = el('goal-create-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const feedback = el('goal-create-feedback');
      const title = el('goal-title-input').value.trim();
      const objective = el('goal-objective-input').value.trim();
      const successCriteria = el('goal-criteria-input').value.trim();
      if (!title || !objective || !successCriteria) {
        feedback.textContent = '✗ all three fields are required';
        feedback.className = 'test-result error';
        return;
      }
      btn.disabled = true;
      try {
        await fetchJSON(API, {
          method: 'POST',
          body: JSON.stringify({ title, objective, successCriteria }),
        });
        el('goal-title-input').value = '';
        el('goal-objective-input').value = '';
        el('goal-criteria-input').value = '';
        feedback.textContent = '✓ created';
        feedback.className = 'test-result success';
        await Promise.all([refreshList(), refreshBanner()]);
      } catch (err) {
        feedback.textContent = `✗ ${err.message}`;
        feedback.className = 'test-result error';
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindListActions() {
    const list = el('goals-list');
    if (!list) return;
    list.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-goal-action]');
      if (!btn) return;
      const row = btn.closest('[data-goal-id]');
      if (!row) return;
      const id = row.getAttribute('data-goal-id');
      const action = btn.getAttribute('data-goal-action');
      btn.disabled = true;
      try {
        if (action === 'activate') {
          await fetchJSON(`${API}/${id}/activate`, { method: 'POST' });
        } else if (action === 'clear') {
          await fetchJSON(`${API}/current/clear`, { method: 'POST' });
        } else if (action === 'complete') {
          await fetchJSON(`${API}/${id}/complete`, { method: 'POST', body: JSON.stringify({}) });
        } else if (action === 'delete') {
          // No confirm dialog — banner re-shows immediately if a different goal becomes active
          await fetchJSON(`${API}/${id}`, { method: 'DELETE' });
        }
        await Promise.all([refreshList(), refreshBanner()]);
      } catch (err) {
        console.warn('[goals] action failed:', action, err);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindBannerClick() {
    const strip = el('active-goal-strip');
    if (!strip) return;
    strip.addEventListener('click', () => {
      if (window.Router?.navigate) {
        window.Router.navigate('settings');
        // The settings page has multiple tabs; if a future iteration adds
        // tab routing we can scroll to #settings-goals directly.
        setTimeout(() => {
          const section = el('settings-goals');
          if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }
    });
  }

  window.Goals = {
    init() {
      bindCreateForm();
      bindListActions();
      bindBannerClick();
      refreshBanner();
      refreshList();
    },
    refreshBanner,
    refreshList,
  };
})();
