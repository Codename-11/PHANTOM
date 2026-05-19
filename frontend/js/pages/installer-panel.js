// Settings → Tools → Sec-ops installer panel.
//
// Three blocks:
//   1. Host detection card — shows OS, distro, detected package managers,
//      preferred backend. Lets the operator see what we'll use BEFORE
//      they click anything.
//   2. Tier cards — base / offensive / blue, each with installed-vs-total
//      counts and an "Install missing" button. Expand to see per-tool
//      availability and docs links.
//   3. Pending + recent install requests — operator can preview commands,
//      approve, or cancel.

(function () {
  const InstallerPanel = {
    status: null,
    requests: [],
    expanded: new Set(),

    init() {
      const refreshBtn = document.getElementById('installer-refresh-btn');
      if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = '1';
        refreshBtn.addEventListener('click', () => this.load());
      }
      window.addEventListener('phantom:route', (event) => {
        if (event.detail?.route === 'settings') this.load();
      });
      // Initial load is deferred so the Tools tab can mount its host
      // element first.
      setTimeout(() => {
        if (document.getElementById('installer-tiers')) this.load();
      }, 600);
    },

    async load() {
      const tiersEl = document.getElementById('installer-tiers');
      if (!tiersEl) return;
      tiersEl.innerHTML = '<div class="empty-msg">Probing host…</div>';
      try {
        const [statusRes, requestsRes] = await Promise.all([
          fetch('/api/installer/status'),
          fetch('/api/installer/requests?limit=10'),
        ]);
        if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
        this.status = await statusRes.json();
        this.requests = requestsRes.ok ? await requestsRes.json() : [];
        this.render();
      } catch (err) {
        tiersEl.innerHTML = `<div class="empty-msg danger">Failed to load installer: ${this.esc(err.message)}</div>`;
      }
    },

    render() {
      this.renderHost();
      this.renderTiers();
      this.renderRequests();
    },

    renderHost() {
      const host = document.getElementById('installer-host');
      if (!host || !this.status) return;
      const h = this.status.host;
      const managers = Object.entries(h.packageManagers || {})
        .map(([m, ok]) => `<span class="installer-pm ${ok ? 'is-ok' : 'is-off'}">${this.esc(m)}${ok ? '' : ' ✗'}</span>`)
        .join(' ');
      const preferred = h.preferred
        ? `<span class="installer-pm is-pref">${this.esc(h.preferred)} (preferred)</span>`
        : `<span class="installer-pm is-off">no package manager detected</span>`;
      const distro = h.distro?.id ? ` · ${this.esc(h.distro.id)}` : '';
      const docker = h.isDocker ? ' · in container' : '';
      host.innerHTML = `
        <div class="installer-host-card">
          <div class="installer-host-text">
            <strong>${this.esc(h.os)}</strong>${distro}${docker}
            <div class="installer-host-pms">${preferred} ${managers}</div>
          </div>
          ${!h.preferred ? `<p class="installer-host-warn">No package manager detected. On Windows, install <a href="https://learn.microsoft.com/en-us/windows/package-manager/winget/" target="_blank" rel="noopener">winget</a> or <a href="https://chocolatey.org/install" target="_blank" rel="noopener">chocolatey</a> first.</p>` : ''}
        </div>
      `;
    },

    renderTiers() {
      const root = document.getElementById('installer-tiers');
      if (!root || !this.status) return;
      const tiers = ['base', 'offensive', 'blue'];
      const labels = {
        base:      { title: 'Base · recon + OSINT', blurb: 'Governed reconnaissance and OSINT collection. Lowest blast radius.' },
        offensive: { title: 'Offensive · red team', blurb: 'Exploit frameworks, password tooling, AD attack-path analysis.' },
        blue:      { title: 'Blue · defense + DFIR', blurb: 'IDS/IPS, packet analysis, memory forensics, malware triage.' },
      };
      root.innerHTML = tiers.map((tier) => {
        const cnt = this.status.byTier[tier] || { total: 0, installed: 0 };
        const expanded = this.expanded.has(tier);
        const tools = this.status.tools.filter(t => t.tier === tier);
        const allInstalled = cnt.total > 0 && cnt.installed === cnt.total;
        return `
          <section class="installer-tier-card is-${tier} ${allInstalled ? 'is-complete' : ''}">
            <header class="installer-tier-hd">
              <div class="installer-tier-text">
                <h4>${this.esc(labels[tier].title)}</h4>
                <p>${this.esc(labels[tier].blurb)}</p>
              </div>
              <div class="installer-tier-meta">
                <div class="installer-tier-count"><strong>${cnt.installed}</strong>/${cnt.total}</div>
                <span class="installer-tier-cap">installed</span>
              </div>
            </header>
            <div class="installer-tier-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-installer-expand="${tier}">${expanded ? 'Hide tools' : 'Show tools'}</button>
              <button type="button" class="btn btn-secondary btn-sm" data-installer-preview="${tier}">Preview commands</button>
              <button type="button" class="btn btn-primary btn-sm" data-installer-request="${tier}" ${allInstalled ? 'disabled' : ''}>${allInstalled ? 'All installed' : `Install missing (${cnt.total - cnt.installed})`}</button>
            </div>
            ${expanded ? `<ul class="installer-tool-list">${tools.map(t => this.renderToolRow(t)).join('')}</ul>` : ''}
          </section>
        `;
      }).join('');
      root.querySelectorAll('[data-installer-expand]').forEach((el) => {
        el.addEventListener('click', () => {
          const tier = el.dataset.installerExpand;
          if (this.expanded.has(tier)) this.expanded.delete(tier);
          else this.expanded.add(tier);
          this.renderTiers();
        });
      });
      root.querySelectorAll('[data-installer-preview]').forEach((el) => {
        el.addEventListener('click', () => this.previewTier(el.dataset.installerPreview));
      });
      root.querySelectorAll('[data-installer-request]').forEach((el) => {
        el.addEventListener('click', () => this.requestTier(el.dataset.installerRequest, el));
      });
    },

    renderToolRow(tool) {
      const cls = tool.available ? 'is-ok' : 'is-missing';
      return `
        <li class="installer-tool-row ${cls}">
          <span class="installer-tool-dot" aria-hidden="true"></span>
          <span class="installer-tool-name"><code>${this.esc(tool.command)}</code></span>
          <span class="installer-tool-sum">${this.esc(tool.summary || '')}</span>
          <a class="installer-tool-docs" href="${this.escAttr(tool.docs)}" target="_blank" rel="noopener">docs ↗</a>
        </li>
      `;
    },

    async previewTier(tier) {
      try {
        const res = await fetch('/api/installer/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.showCommandModal(`Preview · ${tier}`, data.plan, data.summary);
      } catch (err) {
        this.toast(`Preview failed: ${err.message}`, 'danger');
      }
    },

    async requestTier(tier, btn) {
      const onlyMissing = (this.status.tools || [])
        .filter(t => t.tier === tier && !t.available)
        .map(t => t.id);
      if (!onlyMissing.length) {
        this.toast(`All ${tier} tools already installed.`, 'ok');
        return;
      }
      const original = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Requesting…'; }
      try {
        const res = await fetch('/api/installer/request', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolIds: onlyMissing, note: `Install missing ${tier} tools` }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.toast(`Install request created · ${data.summary.installable}/${data.summary.total} resolved. Approve in the Approvals queue or below.`, 'ok');
        await this.load();
      } catch (err) {
        this.toast(`Request failed: ${err.message}`, 'danger');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
      }
    },

    renderRequests() {
      const host = document.getElementById('installer-requests');
      if (!host) return;
      if (!this.requests.length) {
        host.innerHTML = '<h4 class="installer-requests-h">Install requests</h4><p class="installer-empty">No install requests yet.</p>';
        return;
      }
      host.innerHTML = `
        <h4 class="installer-requests-h">Install requests</h4>
        ${this.requests.map(r => this.renderRequest(r)).join('')}
      `;
      host.querySelectorAll('[data-req-approve]').forEach((el) => {
        el.addEventListener('click', () => this.approveRequest(el.dataset.reqApprove, el));
      });
      host.querySelectorAll('[data-req-cancel]').forEach((el) => {
        el.addEventListener('click', () => this.cancelRequest(el.dataset.reqCancel, el));
      });
      host.querySelectorAll('[data-req-toggle]').forEach((el) => {
        el.addEventListener('click', () => {
          const panel = el.closest('.installer-req-card')?.querySelector('.installer-req-detail');
          if (panel) panel.classList.toggle('is-open');
        });
      });
      // "Copy elevated cmd" affordance — for Windows installs and POSIX
      // boxes without a cached sudo password. Pasting into an admin
      // PowerShell / sudo-enabled shell completes what we couldn't.
      host.querySelectorAll('[data-installer-copy]').forEach((el) => {
        el.addEventListener('click', async () => {
          const original = el.textContent;
          try {
            await navigator.clipboard.writeText(el.dataset.installerCopy);
            el.textContent = 'Copied ✓';
            this.toast('Elevated command copied. Paste it into an admin shell.', 'ok');
          } catch {
            el.textContent = 'Copy failed';
          }
          setTimeout(() => { el.textContent = original; }, 1600);
        });
      });
    },

    renderRequest(r) {
      const pendingCt = r.plan.filter(p => p.backend).length;
      const skipCt = r.plan.length - pendingCt;
      const isPending = r.status === 'pending';
      return `
        <div class="installer-req-card status-${this.esc(r.status)}">
          <header class="installer-req-hd">
            <span class="installer-req-status">${this.esc(r.status)}</span>
            <strong>${r.toolIds.length} tools · ${pendingCt} installable${skipCt ? ` · ${skipCt} skipped` : ''}</strong>
            <span class="installer-req-id">${this.esc(r.id.slice(0, 8))}</span>
            <span class="installer-req-grow"></span>
            <button class="btn ghost sm" data-req-toggle>Details</button>
            ${isPending ? `<button class="btn btn-secondary btn-sm" data-req-cancel="${this.escAttr(r.id)}">Cancel</button>` : ''}
            ${isPending ? `<button class="btn btn-primary btn-sm" data-req-approve="${this.escAttr(r.id)}">Approve & install</button>` : ''}
          </header>
          <div class="installer-req-detail">
            <table class="installer-req-table">
              <thead><tr><th>Tool</th><th>Backend</th><th>Command</th><th>Result</th></tr></thead>
              <tbody>
                ${r.plan.map((p) => {
                  const step = r.result?.steps?.find(s => s.id === p.id);
                  const stepCell = this.renderStepStatus(step, p);
                  const cmd = p.backend ? `${this.esc(p.command)} ${this.esc((p.args || []).join(' '))}` : '—';
                  return `<tr>
                    <td><code>${this.esc(p.id)}</code></td>
                    <td>${p.backend ? this.esc(p.backend) : '—'}</td>
                    <td class="installer-req-cmd"><code>${cmd}</code></td>
                    <td>${stepCell}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    },

    // Step status rendering with the privilege-failure callout. When the
    // backend marks classification.kind === 'admin', surface a clear
    // "needs admin" pill plus a copy-the-elevated-command affordance so
    // the operator has a one-step path forward instead of staring at a
    // raw exit code.
    renderStepStatus(step, plan) {
      if (!step) return plan.backend ? '<span class="muted">queued</span>' : `<span class="muted">skipped · ${this.esc(plan.reason || 'no backend')}</span>`;
      if (step.skipped) return `<span class="installer-step skipped">skipped · ${this.esc(step.reason || '')}</span>`;
      const kind = step.classification?.kind || (step.exit === 0 ? 'ok' : 'failed');
      if (kind === 'ok') return '<span class="installer-step exit-ok">exit 0 · ok</span>';
      if (kind === 'timeout') return '<span class="installer-step exit-fail">timed out</span>';
      if (kind === 'admin') {
        const cmd = step.elevatedCommand || '';
        return `
          <span class="installer-step needs-admin">needs admin</span>
          ${cmd ? `<button type="button" class="installer-step-copy" data-installer-copy="${this.escAttr(cmd)}" title="Copy elevated command to clipboard">Copy elevated cmd</button>` : ''}
        `;
      }
      return `<span class="installer-step exit-fail">exit ${step.exit}</span>`;
    },

    async approveRequest(id, btn) {
      if (!confirm('Run the install commands now? Each step runs sequentially via the resolved package manager.')) return;
      const original = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
      try {
        const res = await fetch(`/api/installer/requests/${encodeURIComponent(id)}/approve`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = await res.json();
        this.toast(`Install ${updated.status}. ${this.resultBlurb(updated)}`, updated.status === 'completed' ? 'ok' : 'danger');
        await this.load();
      } catch (err) {
        this.toast(`Approve failed: ${err.message}`, 'danger');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
      }
    },

    async cancelRequest(id, btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
      try {
        const res = await fetch(`/api/installer/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await this.load();
      } catch (err) {
        this.toast(`Cancel failed: ${err.message}`, 'danger');
      }
    },

    resultBlurb(req) {
      if (!req.result?.steps) return '';
      const ok = req.result.steps.filter(s => s.exit === 0).length;
      const fail = req.result.steps.filter(s => s.exit !== 0 && !s.skipped).length;
      const skip = req.result.steps.filter(s => s.skipped).length;
      return `${ok} ok · ${fail} failed · ${skip} skipped.`;
    },

    showCommandModal(title, plan, summary) {
      // Lightweight inline preview — uses a <details> rather than a full
      // modal since the operator can also see the same details on the
      // pending request card after they hit "Install missing".
      const txt = plan.map(p => p.backend ? `${p.command} ${(p.args || []).join(' ')}` : `# skipped: ${p.id} · ${p.reason}`).join('\n');
      alert(`${title}\n\n${summary.installable}/${summary.total} installable via: ${summary.backends.join(', ') || '(none)'}\n\n${txt}`);
    },

    toast(message, kind = 'ok') {
      let host = document.getElementById('installer-toast');
      if (!host) {
        host = document.createElement('div');
        host.id = 'installer-toast';
        host.className = 'installer-toast';
        document.body.appendChild(host);
      }
      host.className = `installer-toast is-${kind}`;
      host.textContent = message;
      host.classList.add('is-visible');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => host.classList.remove('is-visible'), 4200);
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

  window.InstallerPanel = InstallerPanel;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => InstallerPanel.init());
  } else {
    InstallerPanel.init();
  }
})();
