(function attachScopeBuilder(global) {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderTargetChips(targets = []) {
    if (!targets.length) return '<div class="empty-msg">Paste targets to generate editable chips.</div>';
    return targets.map(target => `
      <span class="target-chip ${target.visibility || 'unknown'}" data-target-id="${escapeHtml(target.id || `${target.type}:${target.value}`)}">
        <strong>${escapeHtml(target.type || 'target')}</strong>
        <span>${escapeHtml(target.value)}</span>
        <small>${escapeHtml(target.visibility || 'unknown')}</small>
        <button type="button" data-remove-target="${escapeHtml(target.id || `${target.type}:${target.value}`)}" aria-label="Remove ${escapeHtml(target.value)}">×</button>
      </span>`).join('');
  }

  function renderPolicyPreview(decision = null) {
    if (!decision) return '<div class="policy-preview idle">Run a dry-run policy check before launching tools.</div>';
    const status = decision.allowed ? 'Allowed' : 'Blocked';
    const cls = decision.allowed ? 'allowed' : 'blocked';
    return `<div class="policy-preview ${cls}"><strong>${status}</strong><span>Risk: ${escapeHtml(decision.risk || 'unknown')}</span><p>${escapeHtml(decision.reason || '')}</p><small>Targets: ${escapeHtml((decision.targets || []).join(', ') || 'none detected')}</small></div>`;
  }

  function templateToDraft(template = {}) {
    return {
      nameSuffix: template.name || 'Custom Scope',
      allowedActions: Array.isArray(template.allowedActions) ? [...template.allowedActions] : [],
      blockedActions: Array.isArray(template.blockedActions) ? [...template.blockedActions] : [],
      notes: template.notes || template.summary || '',
      toolpackIds: Array.isArray(template.toolpackIds) ? [...template.toolpackIds] : [],
    };
  }

  const api = { renderTargetChips, renderPolicyPreview, templateToDraft, escapeHtml };
  global.ScopeBuilder = api;
})(typeof window !== 'undefined' ? window : globalThis);
