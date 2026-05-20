// Settings → Tools → Toolpack profiles panel.
//
// A profile is a named bag of tool ids that resolves two ways:
//   • build-time → `GET /api/profiles/:id/dockerfile` returns a RUN
//                  fragment baked into the PHANTOM image.
//   • runtime    → `POST /api/profiles/:id/install` enqueues an install
//                  request through the existing approvals queue. Operator
//                  approves via the Approvals page (same queue the
//                  sec-ops installer uses).
//
// Surfaces, top to bottom:
//   1. Header row with "Refresh" + "New profile" buttons.
//   2. New / edit form (inline; hidden until "New profile" is clicked or
//      a row's Edit button fires). Name (required), description, tool
//      multi-select. The select is populated from `/api/installer/status`
//      so operators only see tools we know how to install.
//   3. List of profiles — one row per profile with Apply runtime, Export
//      Dockerfile, Edit, Delete actions. The list reuses the row
//      contract from installer-panel (table-shaped, status pill via class).
//   4. A small caption explaining the Dockerfile-export coupling to
//      `/tmp/install-profile.sh` — the snippet is only valid alongside
//      the PHANTOM container image (Phase 3 ships the script).
//
// Style: mirrors installer-panel.js — vanilla JS IIFE, innerHTML inject,
// query+rebind event handlers after every render. No framework, no deps.

(function () {
  const ProfilesPanel = {
    profiles: [],
    catalog: [],
    editing: null,         // profile id being edited, or 'new' for create
    formOpen: false,
    formError: null,       // { field: 'name', message: '...' } | null
    busy: false,
    catalogLoaded: false,

    init() {
      const refreshBtn = document.getElementById('profiles-refresh-btn');
      if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = '1';
        refreshBtn.addEventListener('click', () => this.load());
      }
      const newBtn = document.getElementById('profiles-new-btn');
      if (newBtn && !newBtn.dataset.bound) {
        newBtn.dataset.bound = '1';
        newBtn.addEventListener('click', () => this.openForm('new'));
      }
      window.addEventListener('phantom:route', (event) => {
        if (event.detail?.route === 'settings') this.load();
      });
      // Defer initial load so the host element is mounted before we
      // poke at it. Mirrors installer-panel.
      setTimeout(() => {
        if (document.getElementById('profiles-list')) this.load();
      }, 600);
    },

    async load() {
      const listEl = document.getElementById('profiles-list');
      if (!listEl) return;
      if (!this.profiles.length) {
        listEl.innerHTML = '<div class="empty-msg">Loading profiles…</div>';
      }
      try {
        const fetches = [fetch('/api/profiles')];
        // Hydrate the catalog once per session — it doesn't change while
        // the page is open and saves a round-trip on every refresh.
        if (!this.catalogLoaded) fetches.push(fetch('/api/installer/status'));
        const results = await Promise.all(fetches);
        const profilesRes = results[0];
        if (!profilesRes.ok) throw new Error(`HTTP ${profilesRes.status}`);
        this.profiles = await profilesRes.json();
        if (results[1]) {
          if (results[1].ok) {
            const status = await results[1].json();
            this.catalog = Array.isArray(status.tools) ? status.tools : [];
          }
          this.catalogLoaded = true;
        }
        this.render();
      } catch (err) {
        listEl.innerHTML = `<div class="empty-msg danger">Failed to load profiles: ${this.esc(err.message)}</div>`;
      }
    },

    render() {
      this.renderForm();
      this.renderList();
      this.renderCaption();
    },

    // List view — table-shaped rows. Empty state is a single muted line
    // pointing the operator at "New profile".
    renderList() {
      const root = document.getElementById('profiles-list');
      if (!root) return;
      if (!this.profiles.length) {
        root.innerHTML = '<p class="profiles-empty empty-msg">No profiles yet. Click <strong>New profile</strong> to create one — bundle a set of tool ids, then export a Dockerfile fragment or apply at runtime.</p>';
        return;
      }
      root.innerHTML = `
        <table class="profiles-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th class="num">Tools</th>
              <th>Updated</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.profiles.map(p => this.renderRow(p)).join('')}
          </tbody>
        </table>
      `;
      root.querySelectorAll('[data-profile-edit]').forEach((el) => {
        el.addEventListener('click', () => this.openForm(el.dataset.profileEdit));
      });
      root.querySelectorAll('[data-profile-delete]').forEach((el) => {
        el.addEventListener('click', () => this.deleteProfile(el.dataset.profileDelete, el));
      });
      root.querySelectorAll('[data-profile-install]').forEach((el) => {
        el.addEventListener('click', () => this.applyRuntime(el.dataset.profileInstall, el));
      });
      root.querySelectorAll('[data-profile-export]').forEach((el) => {
        el.addEventListener('click', () => this.exportDockerfile(el.dataset.profileExport, el));
      });
    },

    renderRow(profile) {
      // Phase 4 ships timestamps as ms-epoch INTEGERs (not ISO strings
      // like the legacy tables). `new Date(ms)` is correct; `Date.parse`
      // would coerce to NaN. updated_at can also be missing on profiles
      // that were just created in a stale tab — fall back to the dash.
      const updated = profile.updated_at
        ? new Date(profile.updated_at).toLocaleString()
        : '—';
      const toolCount = Array.isArray(profile.tool_ids) ? profile.tool_ids.length : 0;
      return `
        <tr class="profiles-row" data-profile-id="${this.escAttr(profile.id)}">
          <td class="profiles-name"><strong>${this.esc(profile.name)}</strong></td>
          <td class="profiles-desc">${this.esc(profile.description || '')}</td>
          <td class="num">${toolCount}</td>
          <td class="profiles-updated">${this.esc(updated)}</td>
          <td class="actions">
            <button type="button" class="btn btn-primary btn-sm" data-profile-install="${this.escAttr(profile.id)}" title="Enqueue a runtime install request through Approvals">Apply runtime</button>
            <button type="button" class="btn btn-secondary btn-sm" data-profile-export="${this.escAttr(profile.id)}" title="Download a Dockerfile RUN fragment">Export Dockerfile</button>
            <button type="button" class="btn btn-secondary btn-sm" data-profile-edit="${this.escAttr(profile.id)}">Edit</button>
            <button type="button" class="btn ghost sm" data-profile-delete="${this.escAttr(profile.id)}">Delete</button>
          </td>
        </tr>
      `;
    },

    renderForm() {
      const root = document.getElementById('profiles-form');
      if (!root) return;
      if (!this.formOpen) { root.innerHTML = ''; return; }
      const isNew = this.editing === 'new';
      const current = isNew ? null : this.profiles.find(p => p.id === this.editing);
      const name = current?.name || '';
      const description = current?.description || '';
      const selected = new Set((current?.tool_ids) || []);
      const tools = this.catalog.length
        ? this.catalog
        // Fallback: if the catalog hasn't loaded yet, still let the
        // operator type tool ids manually in the multi-select via the
        // currently-selected set. They'll re-render fully on the next
        // load() pass.
        : Array.from(selected).map(id => ({ id, command: id, tier: '', summary: '' }));
      const nameErrorClass = this.formError?.field === 'name' ? ' has-error' : '';
      const nameErrorMsg = this.formError?.field === 'name'
        ? `<p class="profiles-form-err">${this.esc(this.formError.message)}</p>`
        : '';
      root.innerHTML = `
        <form class="profiles-form" data-profile-form>
          <h4>${isNew ? 'New profile' : 'Edit profile'}</h4>
          <label class="profiles-field${nameErrorClass}">
            <span>Name <em>required</em></span>
            <input type="text" name="name" value="${this.escAttr(name)}" required autocomplete="off" />
            ${nameErrorMsg}
          </label>
          <label class="profiles-field">
            <span>Description</span>
            <input type="text" name="description" value="${this.escAttr(description)}" autocomplete="off" />
          </label>
          <label class="profiles-field">
            <span>Tools (${tools.length} available · ⌘/Ctrl-click to multi-select)</span>
            <select name="toolIds" multiple size="${Math.min(Math.max(tools.length, 4), 10)}">
              ${tools.map(t => `<option value="${this.escAttr(t.id)}"${selected.has(t.id) ? ' selected' : ''}>${this.esc(t.command || t.id)}${t.tier ? ` · ${this.esc(t.tier)}` : ''}${t.summary ? ` — ${this.esc(t.summary)}` : ''}</option>`).join('')}
            </select>
          </label>
          <div class="profiles-form-actions">
            <button type="submit" class="btn btn-primary btn-sm" ${this.busy ? 'disabled' : ''}>${isNew ? 'Create profile' : 'Save changes'}</button>
            <button type="button" class="btn btn-secondary btn-sm" data-profile-cancel>Cancel</button>
          </div>
        </form>
      `;
      const form = root.querySelector('[data-profile-form]');
      if (form) form.addEventListener('submit', (event) => { event.preventDefault(); this.submitForm(form); });
      const cancel = root.querySelector('[data-profile-cancel]');
      if (cancel) cancel.addEventListener('click', () => this.closeForm());
    },

    renderCaption() {
      const cap = document.getElementById('profiles-caption');
      if (!cap) return;
      cap.innerHTML = `Exported snippets call <code>/tmp/install-profile.sh</code> from the container — only valid alongside the PHANTOM image. Use <strong>Apply runtime</strong> for ad-hoc installs on an already-running host.`;
    },

    openForm(target) {
      this.editing = target;
      this.formOpen = true;
      this.formError = null;
      this.renderForm();
    },

    closeForm() {
      this.editing = null;
      this.formOpen = false;
      this.formError = null;
      this.renderForm();
    },

    async submitForm(form) {
      const data = this.readForm(form);
      if (!data.name) {
        this.formError = { field: 'name', message: 'Name is required.' };
        this.renderForm();
        return;
      }
      this.busy = true;
      const isNew = this.editing === 'new';
      const url = isNew ? '/api/profiles' : `/api/profiles/${encodeURIComponent(this.editing)}`;
      const method = isNew ? 'POST' : 'PUT';
      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.status === 400) {
          // Surface the name-uniqueness error inline on the name field
          // rather than as a toast. The backend returns
          // `profile name "<x>" already exists` for this case.
          const body = await res.json().catch(() => ({}));
          const message = body?.error || 'Validation error.';
          if (/name/i.test(message) && /(exists|required)/i.test(message)) {
            this.formError = { field: 'name', message };
          } else {
            this.formError = { field: 'name', message };
          }
          this.busy = false;
          this.renderForm();
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.busy = false;
        this.formError = null;
        this.formOpen = false;
        this.editing = null;
        this.toast(isNew ? 'Profile created.' : 'Profile saved.', 'ok');
        await this.load();
      } catch (err) {
        this.busy = false;
        this.toast(`Save failed: ${err.message}`, 'danger');
        this.renderForm();
      }
    },

    readForm(form) {
      const get = (name) => form?.elements?.[name];
      const nameEl = get('name');
      const descEl = get('description');
      const toolsEl = get('toolIds');
      const name = nameEl ? String(nameEl.value || '').trim() : '';
      const description = descEl ? String(descEl.value || '').trim() : '';
      let toolIds = [];
      if (toolsEl) {
        if (toolsEl.selectedOptions) {
          toolIds = Array.from(toolsEl.selectedOptions).map(o => o.value).filter(Boolean);
        } else if (toolsEl.options) {
          toolIds = Array.from(toolsEl.options).filter(o => o.selected).map(o => o.value);
        }
      }
      return { name, description, toolIds };
    },

    async deleteProfile(id, btn) {
      const profile = this.profiles.find(p => p.id === id);
      const label = profile?.name || 'this profile';
      if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
      const original = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
      try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.toast('Profile deleted.', 'ok');
        await this.load();
      } catch (err) {
        this.toast(`Delete failed: ${err.message}`, 'danger');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
      }
    },

    async applyRuntime(id, btn) {
      // POSTs to /api/profiles/:id/install which enqueues into the
      // shared install_requests table — the same queue the sec-ops
      // installer uses. The toast points the operator at Approvals so
      // they can find the request without hunting.
      const original = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Queueing…'; }
      try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(id)}/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const total = data?.summary?.total ?? 0;
        const installable = data?.summary?.installable ?? 0;
        this.toast(`Queued in Approvals — go review. ${installable}/${total} installable.`, 'ok', {
          action: { label: 'Open Approvals', route: 'approvals' },
        });
      } catch (err) {
        this.toast(`Apply runtime failed: ${err.message}`, 'danger');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
      }
    },

    async exportDockerfile(id, btn) {
      // GETs the text/plain RUN fragment and triggers a browser download
      // named <profile-name>.dockerfile. Uses URL.createObjectURL on a
      // Blob — same pattern other download surfaces use. Falls back to
      // opening in a new tab if Blob is unavailable in the host browser.
      const profile = this.profiles.find(p => p.id === id);
      const safeName = (profile?.name || 'profile').replace(/[^A-Za-z0-9._-]+/g, '_');
      const original = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
      try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(id)}/dockerfile`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        // Reference URL/Blob via window so the test sandbox can inject
        // shims — bare `URL` resolves against the sandbox globalThis,
        // which doesn't have a WHATWG URL by default in node:vm.
        const W = (typeof window !== 'undefined' ? window : globalThis);
        const BlobCtor = W.Blob || Blob;
        const blob = new BlobCtor([text], { type: 'text/plain;charset=utf-8' });
        const url = W.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.dockerfile`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Let the browser flush the download before we revoke the blob.
        setTimeout(() => W.URL.revokeObjectURL(url), 1000);
        this.toast('Dockerfile fragment downloaded.', 'ok');
      } catch (err) {
        this.toast(`Export failed: ${err.message}`, 'danger');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
      }
    },

    // Toast with an optional action — when "Apply runtime" enqueues a
    // request, the toast surfaces a one-click jump to the Approvals
    // page. Matches the look-and-feel of installer-panel's toast so the
    // operator's mental model is consistent.
    toast(message, kind = 'ok', opts = {}) {
      let host = document.getElementById('profiles-toast');
      if (!host) {
        host = document.createElement('div');
        host.id = 'profiles-toast';
        host.className = 'installer-toast';
        document.body.appendChild(host);
      }
      host.className = `installer-toast is-${kind}`;
      host.textContent = '';
      const text = document.createElement('span');
      text.textContent = message;
      host.appendChild(text);
      if (opts.action?.label && opts.action?.route) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'installer-toast-action';
        btn.textContent = opts.action.label;
        btn.addEventListener('click', () => {
          try { window.Router?.navigate?.(opts.action.route); } catch {}
        });
        host.appendChild(btn);
      }
      host.classList.add('is-visible');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => host.classList.remove('is-visible'), 5200);
    },

    esc(value) {
      const d = document.createElement('div');
      d.textContent = value == null ? '' : String(value);
      return d.innerHTML;
    },
    escAttr(value) {
      return this.esc(value).replace(/"/g, '&quot;');
    },
  };

  window.ProfilesPanel = ProfilesPanel;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ProfilesPanel.init());
  } else {
    ProfilesPanel.init();
  }
})();
