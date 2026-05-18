(function attachSettingsPagePresenter(global) {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderGeneralOverview(settings = {}) {
    const baseUrl = settings.baseUrl || 'http://127.0.0.1:8648/v1';
    const model = settings.model || 'grok-4.3';
    const workspace = settings.workspace || 'workspace/';
    return `
      <div class="settings-card-grid">
        <article class="settings-info-card"><p class="eyebrow">Runtime</p><h3>${escapeHtml(model)}</h3><p>Active model used for new PHANTOM runs. Change it from the Models tab.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Provider route</p><h3>${escapeHtml(baseUrl.includes('8648') ? 'Hermes routed proxy' : 'Custom OpenAI-compatible endpoint')}</h3><p><code>${escapeHtml(baseUrl)}</code></p></article>
        <article class="settings-info-card"><p class="eyebrow">Workspace</p><h3>Run artifacts</h3><p><code>${escapeHtml(workspace)}</code></p></article>
        <article class="settings-info-card"><p class="eyebrow">Safety</p><h3>Secrets redacted</h3><p>API keys, credential references, and prompt snapshots are shown as <code>[REDACTED]</code> or masked values.</p></article>
      </div>`;
  }

  function renderBehaviorOverview() {
    return `
      <div class="settings-card-grid">
        <article class="settings-info-card"><p class="eyebrow">Run behavior</p><h3>Trace-first operations</h3><p>Every model response, tool call, artifact, and policy decision is persisted as run telemetry before it is displayed.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Prompt order</p><h3>Layered prompts</h3><p>Resolved prompt = base + profile/mode + scope/rules + policy/toolpack fragments + custom fragments.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Governance</p><h3>Block before execute</h3><p>Risky actions are evaluated against active scope before commands run; blocked actions still produce audit trace events.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Operator UX</p><h3>Replayable runs</h3><p>Runs, Graph, and Artifacts consume the same append-only trace stream for historical inspection.</p></article>
      </div>`;
  }

  function renderSecurityOverview(toolpacks = []) {
    const names = toolpacks.map(pack => `<span class="asset-chip">${escapeHtml(pack.name)}</span>`).join('');
    return `
      <div class="settings-card-grid">
        <article class="settings-info-card wide"><p class="eyebrow">Security / Scope</p><h3>Governed execution</h3><p>Expired, denied, out-of-scope, destructive, online brute-force, and credentialed actions are blocked unless the selected scope explicitly permits the risk class and target.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Scope Builder</p><h3>Targets / Scope page</h3><p>Use the guided builder to parse URLs, domains, IPs, CIDRs, and host:port targets into editable governed scopes.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Policy preview</p><h3>Dry-run validation</h3><p>Draft scopes can test a proposed command against the same evaluator used by real tool execution.</p></article>
        <article class="settings-info-card wide"><p class="eyebrow">Available toolpacks</p><div class="asset-chip-row">${names || '<span class="asset-chip">Loading toolpacks…</span>'}</div></article>
      </div>`;
  }

  function renderToolpackCards(toolpacks = []) {
    if (!toolpacks.length) return '<div class="empty-msg">No toolpacks returned yet. Refresh after the server has loaded the current code.</div>';
    return toolpacks.map(pack => {
      const levelNames = pack.levels ? Object.values(pack.levels).map(level => level.name || '').filter(Boolean).join(' / ') : '';
      return `
      <article class="toolpack-card">
        <div><strong>${escapeHtml(pack.name)}</strong><p>${escapeHtml(pack.summary)}</p></div>
        <div class="asset-chip-row">
          <span class="asset-chip">Risks: ${escapeHtml((pack.risks || []).join(', ') || 'none')}</span>
          <span class="asset-chip">${pack.policy?.scopeRequired ? 'Scope required' : 'Scope optional'}</span>
          ${levelNames ? `<span class="asset-chip">Levels: ${escapeHtml(levelNames)}</span>` : ''}
          <span class="asset-chip">Blocked: ${escapeHtml((pack.blockedByDefault || []).join(', ') || 'none')}</span>
        </div>
        <details><summary>${(pack.tools || []).length} tools with install hints</summary>${(pack.tools || []).map(tool => `<div class="target-row"><span>${escapeHtml(tool.name)} · ${escapeHtml(tool.risk)}${tool.scopeRequired ? ' · scoped' : ''}</span><strong>${escapeHtml(tool.installHint || 'installed externally')}</strong></div>`).join('')}</details>
      </article>`;
    }).join('');
  }

  function renderToolpackError(message) {
    return `<div class="empty-msg danger"><strong>Failed to load toolpacks.</strong><p>${escapeHtml(message)}</p><p>If this panel stays empty after a code update, restart the PHANTOM dev service so the Express API reloads <code>/api/toolpacks</code>.</p></div>`;
  }

  function renderAdvancedOverview() {
    return `
      <div class="settings-card-grid">
        <article class="settings-info-card"><p class="eyebrow">Persistence</p><h3>SQLite + workspace files</h3><p>Runs, traces, scopes, prompts, assets, findings, snapshots, and artifacts are persisted locally.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Replay</p><h3>Derived graph state</h3><p>Graph and replay state is derived from trace events and artifacts; there is no second frontend-only source of truth.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Integrations</p><h3>MCP / skills drawer</h3><p>Tool and skill management remains available from the quick drawer while this page focuses on run governance.</p></article>
        <article class="settings-info-card"><p class="eyebrow">Next controls</p><h3>Approval queue later</h3><p>Current policy is block-and-explain. Human approval queues and prompt version rollback remain later-phase work.</p></article>
      </div>`;
  }

  global.SettingsPagePresenter = {
    escapeHtml,
    renderGeneralOverview,
    renderBehaviorOverview,
    renderSecurityOverview,
    renderToolpackCards,
    renderToolpackError,
    renderAdvancedOverview,
  };
})(typeof window !== 'undefined' ? window : globalThis);
