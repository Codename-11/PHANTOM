// Run detail → Evidence tab (A4).
//
// Mounts inside the existing #run-tab-body container. Reuses the
// run-evidence-pane <div> added to frontend/index.html. Renders the
// unified evidence bundle from GET /api/runs/:id/evidence with:
//   - run-level KPI tiles (tool calls / findings / artifacts / blocked / errors)
//   - scope snapshot + prompt snapshot accordions
//   - findings table
//   - artifacts list
//   - export controls (Markdown + JSON)
//
// All values come pre-redacted from the server (evidence-builder runs
// the redactor before serializing).

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderKpi({ label, value, status = 'neutral' }) {
    return `
      <div class="run-evid-kpi" data-status="${esc(status)}">
        <span class="run-evid-kpi-num">${esc(value ?? 0)}</span>
        <span class="run-evid-kpi-cap">${esc(label)}</span>
      </div>
    `;
  }

  function renderFindingsTable(findings) {
    if (!findings?.length) return `<div class="run-evid-empty">No findings recorded.</div>`;
    return `
      <table class="run-evid-table">
        <thead><tr><th>Severity</th><th>Title</th><th>Status</th></tr></thead>
        <tbody>
          ${findings.map((f) => `
            <tr data-sev="${esc(f.severity)}">
              <td class="mono">${esc(f.severity || '?')}</td>
              <td>${esc(f.title || '(untitled)')}</td>
              <td class="mono">${esc(f.status || '?')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
  }

  function renderArtifactsList(artifacts) {
    if (!artifacts?.length) return `<div class="run-evid-empty">No artifacts.</div>`;
    return `
      <ul class="run-evid-artifacts">
        ${artifacts.map((a) => `
          <li class="run-evid-artifact">
            <span class="campaign-pill">${esc(a.type || 'artifact')}</span>
            <span class="run-evid-art-title">${esc(a.title || '(untitled)')}</span>
            <span class="mono run-evid-art-id">${esc(a.id?.slice(0, 8) || '')}</span>
          </li>`).join('')}
      </ul>
    `;
  }

  function renderScopeBlock(scope) {
    if (!scope) return `<div class="run-evid-empty">No scope attached.</div>`;
    return `
      <dl class="campaign-meta-dl">
        <dt>Name</dt> <dd>${esc(scope.name || '(unnamed)')}</dd>
        <dt>Allowed</dt> <dd>${(scope.allowed_actions || []).map((a) => `<span class="campaign-chip ok">${esc(a)}</span>`).join('') || '<span class="cf-empty-val">—</span>'}</dd>
        <dt>Blocked</dt> <dd>${(scope.blocked_actions || []).map((a) => `<span class="campaign-chip block">${esc(a)}</span>`).join('') || '<span class="cf-empty-val">—</span>'}</dd>
        <dt>Expires</dt> <dd class="mono">${esc(scope.expires_at || '—')}</dd>
      </dl>
    `;
  }

  function render(host, bundle) {
    if (!bundle) {
      host.innerHTML = window.DataState.renderLoading('Loading evidence…');
      return;
    }
    const s = bundle.summary || {};
    host.innerHTML = `
      <div class="run-evid">
        <header class="run-evid-hd">
          <h3 class="run-evid-title">Evidence</h3>
          <p class="run-evid-help">A redacted rollup of this run — trace, scope, prompt, artifacts, findings. Exports redact secrets before serialization.</p>
          <div class="run-evid-actions">
            <button class="btn primary sm" data-evid-action="export-md">Export Markdown</button>
            <button class="btn ghost sm" data-evid-action="export-json">Export JSON</button>
          </div>
        </header>

        <div class="run-evid-kpis">
          ${renderKpi({ label: 'Tool calls',     value: s.toolCalls,     status: 'neutral' })}
          ${renderKpi({ label: 'Findings',       value: s.findingCount,  status: s.findingCount ? 'high' : 'ok' })}
          ${renderKpi({ label: 'Artifacts',      value: s.artifactCount, status: 'neutral' })}
          ${renderKpi({ label: 'Blocked',        value: s.blockedCount,  status: s.blockedCount ? 'warn' : 'ok' })}
          ${renderKpi({ label: 'Errors',         value: s.errorCount,    status: s.errorCount ? 'crit' : 'ok' })}
        </div>

        <details class="run-evid-section" open>
          <summary>Scope snapshot</summary>
          ${renderScopeBlock(bundle.scope)}
        </details>

        <details class="run-evid-section">
          <summary>Findings (${esc(bundle.findings?.length || 0)})</summary>
          ${renderFindingsTable(bundle.findings)}
        </details>

        <details class="run-evid-section">
          <summary>Artifacts (${esc(bundle.artifacts?.length || 0)})</summary>
          ${renderArtifactsList(bundle.artifacts)}
        </details>

        ${bundle.promptSnapshot ? `
          <details class="run-evid-section">
            <summary>Prompt snapshot</summary>
            <pre class="cf-prompt-preview">${esc(JSON.stringify(bundle.promptSnapshot, null, 2))}</pre>
          </details>` : ''}

        <p class="run-evid-meta mono">generated ${esc(bundle.generatedAt || '—')} · secrets redacted</p>
        <div class="run-evid-feedback" id="run-evid-feedback"></div>
      </div>
    `;
  }

  async function load(runId) {
    return window.apiFetch(`/api/runs/${encodeURIComponent(runId)}/evidence`, { timeoutMs: 6000 });
  }

  async function exportEvidence(runId, format) {
    const res = await window.apiFetch(`/api/runs/${encodeURIComponent(runId)}/evidence/export`, {
      method: 'POST',
      body: JSON.stringify({ format }),
      timeoutMs: 8000,
    });
    return res;
  }

  function bind(host, runId) {
    host.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-evid-action]')?.dataset.evidAction;
      if (!action) return;
      const fb = document.getElementById('run-evid-feedback');
      const btn = e.target.closest('button');
      if (btn) btn.disabled = true;
      try {
        if (action === 'export-md') {
          const art = await exportEvidence(runId, 'markdown');
          if (fb) { fb.textContent = `✓ exported ${art.title} (${art.id?.slice(0, 8)})`; fb.className = 'run-evid-feedback test-result success'; }
        } else if (action === 'export-json') {
          const art = await exportEvidence(runId, 'json');
          if (fb) { fb.textContent = `✓ exported ${art.title} (${art.id?.slice(0, 8)})`; fb.className = 'run-evid-feedback test-result success'; }
        }
      } catch (err) {
        if (fb) { fb.textContent = `✗ ${err.message}`; fb.className = 'run-evid-feedback test-result error'; }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  window.RunEvidenceTab = {
    /**
     * Called by runs-page.js when the operator switches to the
     * evidence tab. host = the `<div data-pane="evidence">` container.
     */
    async show(host, runId) {
      if (!host || !runId) return;
      host.innerHTML = window.DataState.renderLoading('Loading evidence…');
      try {
        const bundle = await load(runId);
        render(host, bundle);
        bind(host, runId);
      } catch (err) {
        host.innerHTML = window.DataState.renderError({ err, retryAction: `evid:${runId}` });
      }
    },
    render, // exported for tests
  };
})();
