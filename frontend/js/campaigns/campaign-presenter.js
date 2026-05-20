// Pure presenters for the Campaigns surface. No DOM listeners, no fetch —
// those live in pages/campaigns-page.js. Kept pure so they can be
// unit-tested with the minimal DOM stub.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusChip(status) {
    return `<span class="campaign-pill campaign-pill-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  }

  function ago(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const delta = (Date.now() - d.getTime()) / 1000;
    if (delta < 60) return `${Math.round(delta)}s`;
    if (delta < 3600) return `${Math.round(delta / 60)}m`;
    if (delta < 86400) return `${Math.round(delta / 3600)}h`;
    return `${Math.round(delta / 86400)}d`;
  }

  function renderRow(c) {
    const tp = (c.toolpack_ids || []).join(', ') || '—';
    const budget = c.run_budget || {};
    const created = c.created_at ? `<span class="campaign-meta-item mono">${escapeHtml(ago(c.created_at))} ago</span>` : '';
    return `
      <li class="campaign-row" data-campaign-id="${escapeHtml(c.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(c.title)}">
        <div class="campaign-row-head">
          ${statusChip(c.status)}
          <span class="campaign-row-title">${escapeHtml(c.title)}</span>
          ${created}
        </div>
        <div class="campaign-row-objective">${escapeHtml((c.objective || '').slice(0, 200))}${(c.objective || '').length > 200 ? '…' : ''}</div>
        <div class="campaign-row-meta">
          <span class="campaign-meta-item">backend: ${escapeHtml(c.worker_backend || 'phantom-native')}</span>
          <span class="campaign-meta-item">toolpacks: ${escapeHtml(tp)}</span>
          <span class="campaign-meta-item">runs cap: ${escapeHtml(String(budget.maxChildRuns ?? '—'))}</span>
          <span class="campaign-meta-item">attempts/goal: ${escapeHtml(String(budget.maxAttemptsPerGoal ?? '—'))}</span>
        </div>
      </li>
    `;
  }

  function renderList(campaigns) {
    if (!Array.isArray(campaigns) || !campaigns.length) {
      return `
        <div class="campaigns-empty">
          <p class="campaigns-empty-title">No campaigns yet</p>
          <p class="campaigns-empty-help">Campaigns are scoped, governed multi-run objectives. Click <strong>+ New campaign</strong> to draft one.</p>
        </div>
      `;
    }
    return `<ul class="campaigns-rows">${campaigns.map(renderRow).join('')}</ul>`;
  }

  // ── Detail drawer panes ────────────────────────────────────────────────

  function renderOverviewPane(replay) {
    const c = replay.campaign;
    const rb = c.run_budget || {};
    const risk = c.risk_budget || {};
    const s = replay.summary;
    return `
      <div class="campaign-overview">
        <dl class="campaign-meta-dl">
          <dt>Backend</dt> <dd>${escapeHtml(c.worker_backend)}</dd>
          <dt>Scope</dt>   <dd>${c.scope_id ? `<span class="mono">${escapeHtml(c.scope_id)}</span>` : '<span class="cf-empty-val">—</span>'}</dd>
          <dt>Toolpacks</dt><dd>${(c.toolpack_ids || []).map((t) => `<span class="campaign-chip">${escapeHtml(t)}</span>`).join('') || '<span class="cf-empty-val">—</span>'}</dd>
          <dt>Started</dt> <dd class="mono">${escapeHtml(c.started_at || '—')}</dd>
          <dt>Ended</dt>   <dd class="mono">${escapeHtml(c.ended_at || '—')}</dd>
        </dl>
        <div class="campaign-kpi-grid">
          <div class="kpi"><span class="kpi-num">${escapeHtml(String(s.totalRuns))}</span><span class="kpi-cap">runs</span></div>
          <div class="kpi"><span class="kpi-num">${escapeHtml(String(s.totalFindings))}</span><span class="kpi-cap">findings</span></div>
          <div class="kpi"><span class="kpi-num">${escapeHtml(String(s.totalArtifacts))}</span><span class="kpi-cap">artifacts</span></div>
          <div class="kpi"><span class="kpi-num">${escapeHtml(String(s.totalBlocked))}</span><span class="kpi-cap">blocked</span></div>
        </div>
        <div class="campaign-budget">
          <span class="cf-hint"><strong>Budget:</strong>
            ${escapeHtml(String(s.budgetUsed.runs))} / ${escapeHtml(String(s.budgetUsed.maxRuns))} runs ·
            ${escapeHtml(String(rb.maxAttemptsPerGoal ?? '—'))} attempts / goal ·
            ${escapeHtml(String(rb.maxWallClockMinutes ?? '—'))}m cap
          </span>
          <span class="cf-hint"><strong>Risk classes:</strong>
            ${(risk.allowedRiskClasses || []).map((r) => `<span class="campaign-chip ok">${escapeHtml(r)}</span>`).join('')}
            ${(risk.blockedRiskClasses || []).map((r) => `<span class="campaign-chip block">${escapeHtml(r)}</span>`).join('')}
          </span>
        </div>
      </div>
    `;
  }

  function renderGoalsPane(replay) {
    if (!replay.goals.length) {
      return `<div class="campaign-empty-pane">No goals queued yet. Add one with <code>POST /api/campaigns/${escapeHtml(replay.campaign.id)}/goals</code>.</div>`;
    }
    return `
      <ol class="campaign-timeline">
        ${replay.goals.map((g) => {
          const verdict = g.evaluator_result || null;
          return `
            <li class="campaign-timeline-item" data-status="${escapeHtml(g.status)}">
              <span class="campaign-timeline-dot" data-status="${escapeHtml(g.status)}"></span>
              <div class="campaign-timeline-body">
                <div class="campaign-timeline-head">
                  <span class="campaign-pill campaign-pill-${escapeHtml(mapGoalStatus(g.status))}">${escapeHtml(g.status)}</span>
                  <span class="campaign-timeline-title">${escapeHtml(g.title)}</span>
                  <span class="campaign-timeline-attempts">${escapeHtml(String(g.attempt_count))} / ${escapeHtml(String(g.max_attempts))}</span>
                </div>
                <p class="campaign-timeline-prompt">${escapeHtml((g.prompt || '').slice(0, 220))}${(g.prompt || '').length > 220 ? '…' : ''}</p>
                ${verdict ? `
                  <div class="campaign-verdict">
                    <span class="campaign-verdict-pill">${escapeHtml(verdict.decision)}</span>
                    <span class="campaign-verdict-summary">${escapeHtml(verdict.summary || '')}</span>
                  </div>` : ''}
              </div>
            </li>
          `;
        }).join('')}
      </ol>
    `;
  }

  function renderRunsPane(replay) {
    if (!replay.runs.length) {
      return `<div class="campaign-empty-pane">No child runs yet. Activate the campaign and use <code>POST /api/campaigns/${escapeHtml(replay.campaign.id)}/run-next</code>.</div>`;
    }
    return `
      <ul class="campaign-runs">
        ${replay.runs.map((r) => `
          <li class="campaign-run-row" data-run-id="${escapeHtml(r.run.id)}" tabindex="0">
            <span class="campaign-run-dot" data-status="${escapeHtml(r.run.status || 'unknown')}"></span>
            <div class="campaign-run-body">
              <div class="campaign-run-head">
                <span class="campaign-run-title">${escapeHtml(r.run.title || r.run.id.slice(0, 8))}</span>
                <span class="mono campaign-run-id">${escapeHtml(r.run.id.slice(0, 8))}</span>
                <span class="campaign-pill campaign-pill-${escapeHtml(mapRunStatus(r.run.status))}">${escapeHtml(r.run.status)}</span>
              </div>
              <div class="campaign-run-meta">
                <span>goal: ${escapeHtml(r.goal?.title || '—')}</span>
                <span>findings: ${escapeHtml(String(r.findingCount))}</span>
                <span>artifacts: ${escapeHtml(String(r.artifactCount))}</span>
                <span>blocked: ${escapeHtml(String(r.blockedCount))}</span>
              </div>
              ${r.evaluator ? `<div class="campaign-verdict-line">verdict <strong>${escapeHtml(r.evaluator.decision)}</strong> — ${escapeHtml(r.evaluator.summary || '')}</div>` : ''}
            </div>
          </li>`).join('')}
      </ul>
    `;
  }

  function renderEvidencePane(replay) {
    return `
      <div class="campaign-evidence">
        <p class="drawer-desc">Generate a campaign-level markdown report or a zip evidence bundle that aggregates every child run.</p>
        <div class="campaign-evidence-actions">
          <button class="btn primary sm" data-campaign-action="report">Generate report</button>
          <button class="btn primary sm" data-campaign-action="evidence">Export evidence bundle</button>
        </div>
        <p class="cf-hint">Artifacts attach to the first linked child run so they appear in <strong>Artifacts</strong>. They are tagged with <code>source=campaign_report</code> / <code>campaign_evidence_bundle</code> for filtering.</p>
        <div id="campaign-evidence-feedback" class="test-result"></div>
      </div>
    `;
  }

  function renderActions(campaign) {
    const buttons = [];
    if (['draft', 'paused', 'queued'].includes(campaign.status)) {
      buttons.push(`<button class="btn primary sm" data-campaign-action="start">Set goal in motion</button>`);
    }
    if (['running', 'needs_approval'].includes(campaign.status)) {
      buttons.push(`<button class="btn ghost sm" data-campaign-action="pause">Pause workers</button>`);
    }
    if (['paused', 'needs_approval'].includes(campaign.status)) {
      buttons.push(`<button class="btn primary sm" data-campaign-action="resume">Resume</button>`);
    }
    if (campaign.status === 'running') {
      buttons.push(`<button class="btn ghost sm" data-campaign-action="run-next">Run next goal</button>`);
    }
    if (!['canceled', 'completed', 'failed'].includes(campaign.status)) {
      buttons.push(`<button class="btn ghost danger sm" data-campaign-action="cancel">Cancel</button>`);
    }
    return buttons.join('');
  }

  // Goal/run status → campaign-pill variant. Keeps the chip styling
  // consistent across goal queue + child run cards.
  function mapGoalStatus(s) {
    if (s === 'completed') return 'completed';
    if (s === 'failed' || s === 'skipped') return 'failed';
    if (s === 'running') return 'running';
    if (s === 'needs_approval') return 'needs_approval';
    if (s === 'blocked') return 'paused';
    return 'draft';
  }
  function mapRunStatus(s) {
    if (s === 'completed') return 'completed';
    if (s === 'failed' || s === 'stopped') return 'failed';
    if (s === 'running') return 'running';
    return 'draft';
  }

  window.CampaignPresenter = {
    renderList, renderRow, statusChip,
    renderOverviewPane, renderGoalsPane, renderRunsPane, renderEvidencePane,
    renderActions, mapGoalStatus, mapRunStatus,
  };
})();
