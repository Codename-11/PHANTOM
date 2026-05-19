// Shared renderer for the end-of-run synthesis data shape.
//
// One module, three callers:
//   1. Phase A — runs-page.js renders the live synthesis after each run.
//   2. Phase B — onboarding wizard previews a stub synthesis so first-time
//      operators see what they'll get when their first run finishes.
//   3. Phase C — trending dashboard uses renderCompactRow() for per-run
//      rows in the timeline.
//
// Pure DOM: this file owns the synthesis HTML and the verbal copy. Pages
// that embed it provide a host element and optional action handlers.

(function () {
  const SEVERITY_BADGES = [
    { key: 'critical', label: 'crit' },
    { key: 'high',     label: 'high' },
    { key: 'medium',   label: 'med'  },
    { key: 'low',      label: 'low'  },
  ];

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function escAttr(value) {
    return esc(value).replace(/"/g, '&quot;');
  }

  function formatDuration(ms) {
    if (ms == null || !Number.isFinite(ms)) return '—';
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function highlightIcon(kind) {
    if (kind === 'win') return '✓';
    if (kind === 'risk') return '⚠';
    return '·';
  }

  function nextStepIcon(kind) {
    if (kind === 'rerun')     return '↻';
    if (kind === 'remediate') return '✚';
    if (kind === 'review')    return '◎';
    if (kind === 'report')    return '✎';
    if (kind === 'expand')    return '⤢';
    return '→';
  }

  function postureRingHtml(score, rating) {
    const pct = Math.max(0, Math.min(100, Number(score) || 0));
    const ratingClass = `is-${rating || 'unknown'}`;
    // SVG donut — 36-radius, 226.2 circumference. Stroke-dasharray is
    // (filled, total). We compute filled = pct/100 * 226.2.
    const dash = ((pct / 100) * 226.2).toFixed(1);
    return `
      <div class="synth-posture-ring ${ratingClass}" aria-label="Posture ${pct} of 100, ${rating || 'unknown'}">
        <svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
          <circle cx="40" cy="40" r="36" fill="none" stroke="var(--line-2, rgba(255,255,255,.08))" stroke-width="6"></circle>
          <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" stroke-width="6"
                  stroke-linecap="round" transform="rotate(-90 40 40)"
                  stroke-dasharray="${dash} 226.2"></circle>
        </svg>
        <div class="synth-posture-num"><strong>${pct}</strong><span>/100</span></div>
      </div>
    `;
  }

  function deltaHtml(delta) {
    if (delta == null || !Number.isFinite(delta)) return '';
    if (delta === 0) return `<span class="synth-delta zero">±0</span>`;
    const arrow = delta > 0 ? '▲' : '▼';
    const cls = delta > 0 ? 'up' : 'down';
    return `<span class="synth-delta ${cls}">${arrow} ${Math.abs(delta)}</span>`;
  }

  function severityBarHtml(bySeverity) {
    const total = SEVERITY_BADGES.reduce((acc, s) => acc + (bySeverity[s.key] || 0), 0);
    if (!total) {
      return '<div class="synth-sev-empty">no findings recorded</div>';
    }
    return `<div class="synth-sev-bar" role="img" aria-label="Findings by severity">
      ${SEVERITY_BADGES.map(s => {
        const count = bySeverity[s.key] || 0;
        if (!count) return '';
        const pct = (count / total) * 100;
        return `<span class="synth-sev-seg sev-${s.key}" style="width:${pct.toFixed(1)}%"
                       title="${count} ${s.label}">${count}</span>`;
      }).join('')}
    </div>`;
  }

  function componentRow(label, value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    return `
      <div class="synth-comp-row">
        <span class="synth-comp-lbl">${esc(label)}</span>
        <span class="synth-comp-bar"><i style="width:${pct}%"></i></span>
        <span class="synth-comp-val">${pct}</span>
      </div>
    `;
  }

  function highlightHtml(h) {
    return `<li class="synth-hl synth-hl-${esc(h.kind || 'note')}">
      <span class="synth-hl-icon" aria-hidden="true">${highlightIcon(h.kind)}</span>
      <span class="synth-hl-text">${esc(h.text)}</span>
    </li>`;
  }

  function nextStepHtml(step, options) {
    const action = step.action ? ` data-synth-action="${escAttr(step.action)}"` : '';
    const Tag = step.action ? 'button' : 'span';
    const cls = step.action ? 'synth-step is-actionable' : 'synth-step';
    const role = step.action ? '' : ' role="note"';
    return `<${Tag} type="button" class="${cls}"${action}${role}>
      <span class="synth-step-icon" aria-hidden="true">${nextStepIcon(step.kind)}</span>
      <span class="synth-step-text">${esc(step.text)}</span>
    </${Tag}>`;
  }

  function approvalsRow(approvals) {
    const entries = Object.entries(approvals || {}).filter(([, v]) => v > 0);
    if (!entries.length) return '<dd class="muted">no approval traffic</dd>';
    return `<dd class="synth-apv">${entries.map(([k, v]) => `<span class="synth-apv-pill"><b>${v}</b> ${esc(k)}</span>`).join(' ')}</dd>`;
  }

  function header(synthesis) {
    const ratingClass = `is-${synthesis.posture?.rating || 'unknown'}`;
    return `
      <header class="synth-hd ${ratingClass}">
        <div class="synth-hd-text">
          <div class="synth-eyebrow">END-OF-RUN SYNTHESIS</div>
          <h3 class="synth-title">${esc(synthesis.title || 'Run')}</h3>
          <p class="synth-outcome">${esc(synthesis.outcome || '')}</p>
          <div class="synth-meta">
            <span class="synth-meta-pill status-${esc(synthesis.status)}">${esc(synthesis.status)}</span>
            ${synthesis.scope ? `<span class="synth-meta-pill kind-scope">${esc(synthesis.scope.name)}</span>` : ''}
            <span class="synth-meta-pill kind-time">${esc(formatDuration(synthesis.durationMs))}</span>
            <span class="synth-meta-pill kind-policy">${esc(synthesis.policy?.mode || 'governed')}</span>
          </div>
        </div>
        <div class="synth-hd-score">
          ${postureRingHtml(synthesis.posture?.score, synthesis.posture?.rating)}
          <div class="synth-score-cap">
            <span class="synth-score-rating">${esc(synthesis.posture?.rating || 'unknown')}</span>
            ${deltaHtml(synthesis.posture?.delta)}
          </div>
        </div>
      </header>
    `;
  }

  function objectiveCard(synthesis) {
    const met = synthesis.objectives?.met || 'unknown';
    const goal = synthesis.objectives?.stated || synthesis.goal || 'No goal recorded.';
    return `
      <section class="synth-card synth-card-objective is-${esc(met)}">
        <h4>Objective</h4>
        <p class="synth-objective-goal">${esc(goal)}</p>
        <div class="synth-objective-met">
          <span class="synth-objective-chip is-${esc(met)}">${esc(met)}</span>
          <span class="synth-objective-signal">${esc(synthesis.objectives?.signal || '')}</span>
        </div>
      </section>
    `;
  }

  function activityCard(synthesis) {
    const a = synthesis.activity || {};
    const t = a.toolCalls || {};
    return `
      <section class="synth-card synth-card-activity">
        <h4>Activity</h4>
        <dl class="synth-kv">
          <dt>events</dt><dd>${a.events ?? 0}</dd>
          <dt>tool calls</dt><dd>${t.total ?? 0} <small>(${t.succeeded ?? 0} ok · ${t.failed ?? 0} failed · ${t.blocked ?? 0} blocked)</small></dd>
          <dt>artifacts</dt><dd>${a.artifacts ?? 0}</dd>
          <dt>approvals</dt>
          ${approvalsRow(synthesis.policy?.approvals)}
        </dl>
      </section>
    `;
  }

  function postureCard(synthesis) {
    const c = synthesis.posture?.components || {};
    return `
      <section class="synth-card synth-card-posture">
        <h4>Posture breakdown</h4>
        ${componentRow('Coverage', c.coverage)}
        ${componentRow('Risk',     c.risk)}
        ${componentRow('Hygiene',  c.hygiene)}
        ${synthesis.findings ? `<div class="synth-findings-row">
          <span class="synth-findings-lbl">Findings</span>
          ${severityBarHtml(synthesis.findings.bySeverity || {})}
          <span class="synth-findings-meta">${synthesis.findings.new} new · ${synthesis.findings.resolved} resolved</span>
        </div>` : ''}
      </section>
    `;
  }

  function highlightsCard(synthesis) {
    const items = synthesis.highlights || [];
    if (!items.length) return '';
    return `
      <section class="synth-card synth-card-highlights">
        <h4>Highlights</h4>
        <ul class="synth-hl-list">${items.map(highlightHtml).join('')}</ul>
      </section>
    `;
  }

  function nextStepsCard(synthesis, options) {
    const steps = synthesis.nextSteps || [];
    if (!steps.length) return '';
    return `
      <section class="synth-card synth-card-next">
        <h4>Next steps</h4>
        <div class="synth-step-list">
          ${steps.map(s => nextStepHtml(s, options)).join('')}
        </div>
      </section>
    `;
  }

  function bindActions(hostEl, synthesis, options) {
    const onAction = options && typeof options.onAction === 'function' ? options.onAction : null;
    if (!onAction) return;
    hostEl.querySelectorAll('[data-synth-action]').forEach((btn) => {
      btn.addEventListener('click', () => onAction(btn.dataset.synthAction, synthesis));
    });
  }

  function render(hostEl, synthesis, options = {}) {
    if (!hostEl) return;
    if (!synthesis) {
      hostEl.innerHTML = '<div class="synth-empty">Synthesis unavailable.</div>';
      return;
    }
    const previewBadge = options.preview
      ? '<span class="synth-preview-banner">PREVIEW · sample data</span>'
      : '';
    hostEl.innerHTML = `
      <article class="synth-card-host">
        ${previewBadge}
        ${header(synthesis)}
        <div class="synth-grid">
          ${objectiveCard(synthesis)}
          ${activityCard(synthesis)}
          ${postureCard(synthesis)}
        </div>
        <div class="synth-grid synth-grid-narrow">
          ${highlightsCard(synthesis)}
          ${nextStepsCard(synthesis, options)}
        </div>
      </article>
    `;
    bindActions(hostEl, synthesis, options);
  }

  // Compact one-row representation for trend timelines (Phase C). Returns
  // an HTML string the caller embeds in its own list/table.
  function renderCompactRow(synthesis) {
    const score = synthesis.posture?.score ?? 0;
    const rating = synthesis.posture?.rating || 'unknown';
    const delta = synthesis.posture?.delta;
    return `<div class="synth-row is-${esc(rating)}" data-run-id="${escAttr(synthesis.runId)}">
      <span class="synth-row-score"><strong>${score}</strong><i>${esc(rating)}</i></span>
      ${delta != null ? deltaHtml(delta) : ''}
      <span class="synth-row-title">${esc(synthesis.title)}</span>
      <span class="synth-row-outcome">${esc(synthesis.outcome || '')}</span>
    </div>`;
  }

  window.SynthesisCard = { render, renderCompactRow };
})();
