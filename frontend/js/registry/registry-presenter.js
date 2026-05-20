// Pure presenter for the Toolpack Registry page (B2).
//
// Renders the manifest list + detail without any fetch / DOM listener
// concerns. Page wrapper (pages/registry-page.js) drives both. Mirrors
// the campaign-presenter pattern so testing stays consistent.

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function statusBadge(valid) {
    return valid
      ? `<span class="campaign-pill campaign-pill-completed">valid</span>`
      : `<span class="campaign-pill campaign-pill-failed">invalid</span>`;
  }

  function trustBadge(m) {
    const declared = m.digest;
    const computed = m.computedDigest;
    if (declared && computed && declared === computed) {
      return `<span class="campaign-pill campaign-pill-running" title="declared digest matches the on-disk SHA-256">trust ✓</span>`;
    }
    if (declared && computed) {
      return `<span class="campaign-pill campaign-pill-paused" title="declared digest does NOT match on-disk SHA-256">unsigned</span>`;
    }
    return `<span class="campaign-pill campaign-pill-draft">unsigned</span>`;
  }

  function renderListRow(m) {
    const idTitle = m.identity?.name || m.id;
    const summary = m.identity?.summary || '—';
    const riskClasses = (m.risk?.action_classes || []).slice(0, 4).join(', ');
    return `
      <li class="registry-row" data-manifest-id="${esc(m.id)}" tabindex="0" role="button" aria-label="Open ${esc(idTitle)}">
        <div class="registry-row-head">
          ${statusBadge(m.valid)}
          ${trustBadge(m)}
          <span class="registry-row-title">${esc(idTitle)}</span>
          <span class="registry-row-version mono">v${esc(m.version || '?')}</span>
        </div>
        <div class="registry-row-summary">${esc(summary)}</div>
        ${riskClasses ? `<div class="registry-row-meta"><span class="campaign-meta-item">risks: ${esc(riskClasses)}</span></div>` : ''}
      </li>
    `;
  }

  function renderList(payload) {
    if (!payload || !Array.isArray(payload.manifests) || !payload.manifests.length) {
      return `
        <div class="campaigns-empty">
          <p class="campaigns-empty-title">No manifests found</p>
          <p class="campaigns-empty-help">Local toolpack manifests live under <code>server/registry/fixtures/</code>. Add one and refresh.</p>
        </div>
      `;
    }
    const s = payload.summary || {};
    const summaryLine = `
      <div class="registry-summary">
        <span class="campaign-meta-item">total ${esc(s.total)}</span>
        <span class="campaign-meta-item">valid ${esc(s.valid)}</span>
        <span class="campaign-meta-item">invalid ${esc(s.invalid)}</span>
      </div>
    `;
    return summaryLine + `<ul class="registry-rows">${payload.manifests.map(renderListRow).join('')}</ul>`;
  }

  function renderDetail(manifest, preview) {
    if (!manifest) {
      return `<div class="ds-card ds-loading">Select a manifest from the left.</div>`;
    }
    const m = manifest.manifest || {};
    const identity = m.identity || {};
    const risk = m.risk || {};
    const tools = m.tools || [];
    const install = m.install || {};
    const lifecycle = m.lifecycle || {};

    const errorBlock = !manifest.valid
      ? `<div class="ds-card ds-error">
           <p class="ds-error-title">Manifest validation failed</p>
           <ul class="ds-error-body">
             ${manifest.errors.map((e) => `<li><code>${esc(e.path || '/')}</code>: ${esc(e.message)}</li>`).join('')}
           </ul>
         </div>`
      : '';

    return `
      ${errorBlock}
      <details class="run-evid-section" open>
        <summary>Identity</summary>
        <dl class="campaign-meta-dl">
          <dt>ID</dt> <dd class="mono">${esc(identity.id || manifest.id)}</dd>
          <dt>Name</dt> <dd>${esc(identity.name || '—')}</dd>
          <dt>Version</dt> <dd class="mono">${esc(identity.version || manifest.version || '?')}</dd>
          <dt>Publisher</dt> <dd>${esc(identity.publisher || '—')}</dd>
          <dt>License</dt> <dd>${esc(identity.license || '—')}</dd>
          <dt>Category</dt> <dd>${esc(identity.category || '—')}</dd>
        </dl>
      </details>

      <details class="run-evid-section" open>
        <summary>Trust</summary>
        <dl class="campaign-meta-dl">
          <dt>Declared digest</dt> <dd class="mono">${esc(m.trust?.digest || '—')}</dd>
          <dt>On-disk digest</dt>  <dd class="mono">${esc(manifest.computedDigest || '—')}</dd>
          <dt>Signed by</dt>       <dd>${esc(m.trust?.signed_by || '—')}</dd>
        </dl>
      </details>

      <details class="run-evid-section" open>
        <summary>Risk classes (${(risk.action_classes || []).length})</summary>
        <div>${(risk.action_classes || []).map((c) => `<span class="campaign-chip">${esc(c)}</span>`).join('') || '<span class="cf-empty-val">—</span>'}</div>
        ${risk.scope_required ? '<p class="cf-hint">Scope is required for this toolpack.</p>' : ''}
        ${risk.network_egress ? `<p class="cf-hint">Network egress: <span class="campaign-chip">${esc(risk.network_egress)}</span></p>` : ''}
      </details>

      <details class="run-evid-section">
        <summary>Tools (${tools.length})</summary>
        <ul class="run-evid-artifacts">
          ${tools.map((t) => `
            <li class="run-evid-artifact">
              <span class="campaign-pill">${esc(t.risk || 'unknown')}</span>
              <span class="run-evid-art-title mono">${esc(t.name || t.command || '?')}</span>
              ${t.gated ? '<span class="campaign-pill campaign-pill-needs_approval">gated</span>' : ''}
            </li>
          `).join('') || '<li class="run-evid-empty">No tools declared.</li>'}
        </ul>
      </details>

      <details class="run-evid-section">
        <summary>Install recipes (${(install.recipes || []).length})</summary>
        <pre class="cf-prompt-preview">${esc(JSON.stringify(install, null, 2))}</pre>
      </details>

      ${preview ? `
        <details class="run-evid-section" open>
          <summary>Preview install plan</summary>
          <p class="cf-hint">${esc(preview.note)}</p>
          <pre class="cf-prompt-preview">${esc(JSON.stringify(preview.plan, null, 2))}</pre>
          <div class="campaign-detail-actions">
            <button class="btn primary sm" data-registry-action="request-install" disabled title="Approvals plumbing lands in a follow-up commit.">Request install (queued)</button>
          </div>
        </details>` : ''}

      ${lifecycle.deprecated_at ? `
        <details class="run-evid-section" open>
          <summary>Lifecycle</summary>
          <dl class="campaign-meta-dl">
            <dt>Deprecated</dt> <dd class="mono">${esc(lifecycle.deprecated_at)}</dd>
            <dt>Replacement</dt> <dd>${esc(lifecycle.replacement || '—')}</dd>
          </dl>
        </details>` : ''}
    `;
  }

  function renderHeader(manifest) {
    const m = manifest?.manifest || {};
    const identity = m.identity || {};
    return {
      title: identity.name || manifest?.id || 'Select a manifest',
      summary: identity.summary || '—',
      id: manifest?.id || '—',
      version: identity.version || manifest?.version || '?',
      pill: manifest?.valid
        ? 'campaign-pill campaign-pill-completed'
        : 'campaign-pill campaign-pill-failed',
      pillText: manifest?.valid ? 'valid' : 'invalid',
    };
  }

  window.RegistryPresenter = {
    renderList, renderListRow, renderDetail, renderHeader,
    statusBadge, trustBadge,
  };
})();
