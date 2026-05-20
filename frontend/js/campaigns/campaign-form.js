// Pure presenter for the Campaign creation form.
//
// `render(state, refs)` returns the form HTML. `refs` contains the
// pre-loaded scopes/profiles/toolpacks/backends arrays so the form can
// be drawn synchronously from cached data. The page wrapper handles
// fetching refs + binding event listeners.
//
// State shape:
//   {
//     title, objective,
//     scopeId, profileId,
//     toolpackIds: string[],
//     backend: 'phantom-native' | 'codex-exec',
//     workdir: string | null,
//     riskBudget: {
//       allowedRiskClasses: string[],
//       blockedRiskClasses: string[],
//       pauseOnNewFinding: boolean,
//       pauseOnApprovalRequired: boolean,
//     },
//     runBudget: { maxChildRuns, maxAttemptsPerGoal, maxWallClockMinutes },
//     initialGoal: { title, prompt } | null,
//   }
//
// Validation surface:
//   `validate(state)` → { ok, errors: { fieldId: string } }
//
// Prompt preview:
//   `generatePromptPreview(state, refs)` → string
//
// Lift the public surface onto window.CampaignForm so the page wrapper
// can call without bundlers.

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Canonical risk-class set mirrors the scope-builder ACTION_CLASSES
  // tax. Operators tick the boxes for what the campaign is authorized to
  // do; everything else is blocked by default + appears in
  // blockedRiskClasses.
  const RISK_CLASSES = [
    { id: 'read/local',              risk: 'low',  label: 'Read / local' },
    { id: 'recon',                   risk: 'low',  label: 'Recon' },
    { id: 'network-scan',            risk: 'med',  label: 'Network scan' },
    { id: 'web-vuln',                risk: 'high', label: 'Web vuln (passive)' },
    { id: 'offline-password-audit',  risk: 'med',  label: 'Offline password audit' },
    { id: 'credentialed',            risk: 'high', label: 'Credentialed', warn: true },
    { id: 'online-bruteforce',       risk: 'high', label: 'Online brute force', warn: true },
    { id: 'exploit',                 risk: 'crit', label: 'Exploit', locked: true },
    { id: 'destructive',             risk: 'crit', label: 'Destructive', locked: true },
  ];
  function getRiskClasses() { return RISK_CLASSES.slice(); }

  // Anything in this set requires an active scope.
  const SCOPE_REQUIRED = new Set([
    'recon', 'network-scan', 'web-vuln', 'credentialed', 'online-bruteforce',
  ]);

  const DEFAULT_STATE = () => ({
    title: '',
    objective: '',
    scopeId: '',
    profileId: '',
    toolpackIds: [],
    backend: 'phantom-native',
    workdir: '',
    runBudget: { maxChildRuns: 10, maxAttemptsPerGoal: 2, maxWallClockMinutes: 120 },
    riskBudget: {
      allowedRiskClasses: ['read/local', 'recon'],
      blockedRiskClasses: ['exploit', 'destructive', 'credentialed', 'online-bruteforce'],
      pauseOnNewFinding: true,
      pauseOnApprovalRequired: true,
    },
    initialGoal: null,
  });

  // ── Field renderers ────────────────────────────────────────────────────

  function renderField({ id, label, hint, body }) {
    return `
      <div class="cf-field" data-field="${esc(id)}">
        <label class="cf-lbl" for="${esc(id)}">${esc(label)}</label>
        ${body}
        ${hint ? `<small class="cf-hint">${esc(hint)}</small>` : ''}
      </div>
    `;
  }

  function renderSegmented({ id, name, value, options, disabled = {} }) {
    return `
      <div class="cf-segmented" role="radiogroup" id="${esc(id)}">
        ${options.map((opt) => {
          const isOn = String(opt.value) === String(value);
          const isOff = disabled[opt.value];
          return `
            <button type="button"
                    class="cf-seg ${isOn ? 'on' : ''}${isOff ? ' off' : ''}"
                    role="radio" aria-checked="${isOn}" aria-disabled="${!!isOff}"
                    data-cf-segmented="${esc(name)}" data-value="${esc(opt.value)}"
                    ${isOff ? 'disabled' : ''}>
              <span class="cf-seg-lbl">${esc(opt.label)}</span>
              ${opt.sub ? `<span class="cf-seg-sub">${esc(opt.sub)}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderChipPicker({ id, name, values, options }) {
    const selected = new Set(values || []);
    if (!options.length) {
      return `<div class="cf-chip-picker cf-empty" id="${esc(id)}">No toolpacks available.</div>`;
    }
    return `
      <div class="cf-chip-picker" id="${esc(id)}" data-cf-chip-name="${esc(name)}">
        ${options.map((opt) => {
          const on = selected.has(opt.id);
          return `
            <button type="button" class="cf-chip ${on ? 'on' : ''}"
                    role="checkbox" aria-checked="${on}"
                    data-cf-chip="${esc(opt.id)}">
              <span class="cf-chip-tick" aria-hidden="true">${on ? '✓' : '+'}</span>
              <span class="cf-chip-lbl">${esc(opt.label || opt.name || opt.id)}</span>
              ${opt.risks?.length ? `<span class="cf-chip-meta">${esc(opt.risks.slice(0, 2).join(', '))}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderRiskGrid({ allowed, blocked }) {
    const allowedSet = new Set(allowed || []);
    return `
      <div class="cf-risk-grid">
        ${RISK_CLASSES.map((r) => {
          const isOn = allowedSet.has(r.id);
          const locked = r.locked;
          return `
            <label class="cf-risk-row ${locked ? 'locked' : ''} ${isOn && !locked ? 'on' : ''}">
              <input type="checkbox" data-cf-risk="${esc(r.id)}"
                ${isOn && !locked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
              <span class="cf-risk-tick" data-risk-tick="${esc(r.risk)}"></span>
              <span class="cf-risk-name">${esc(r.label)}</span>
              ${r.warn ? `<span class="cf-risk-warn" title="Requires explicit operator approval">approval-only</span>` : ''}
              ${locked ? `<span class="cf-risk-locked">locked · deny</span>` : ''}
            </label>
          `;
        }).join('')}
      </div>
    `;
  }

  // ── Composite render ───────────────────────────────────────────────────

  function render(state = DEFAULT_STATE(), refs = {}) {
    const scopes = refs.scopes || [];
    const profiles = refs.profiles || [];
    const toolpacks = refs.toolpacks || [];
    const backendsAvail = new Map((refs.backends || []).map((b) => [b.id, b.available]));

    const scopeOpt = (s) => `<option value="${esc(s.id)}"${s.id === state.scopeId ? ' selected' : ''}>${esc(s.name || s.id)}</option>`;
    const profileOpt = (p) => `<option value="${esc(p.id)}"${p.id === state.profileId ? ' selected' : ''}>${esc(p.name || p.id)}</option>`;

    const backendDisabled = {
      'codex-exec': backendsAvail.get('codex-exec') === false,
    };

    const validation = validate(state);
    const scopeNeeded = validation.errors.scopeId;
    const showWorkdir = state.backend === 'codex-exec';

    return `
      <form class="cf-form" id="campaign-create-form" autocomplete="off" novalidate>
        <section class="cf-section">
          <h3 class="cf-section-title">Identity</h3>

          ${renderField({
            id: 'cf-title', label: 'Title',
            hint: 'Short headline operators will recognize in a queue.',
            body: `<input type="text" id="cf-title" data-cf="title" maxlength="120"
                          placeholder="Map AdminPortal exposure"
                          value="${esc(state.title)}" />`,
          })}

          ${renderField({
            id: 'cf-objective', label: 'Objective',
            hint: 'One-paragraph description. Becomes part of every child run’s system prompt.',
            body: `<textarea id="cf-objective" data-cf="objective" rows="3"
                              placeholder="What we want PHANTOM to accomplish across child runs.">${esc(state.objective)}</textarea>`,
          })}
        </section>

        <section class="cf-section">
          <h3 class="cf-section-title">Governance</h3>

          ${renderField({
            id: 'cf-scopeId', label: `Scope${scopeNeeded ? ' (required for selected risk classes)' : ''}`,
            hint: scopeNeeded
              ? 'A scope is required because at least one network / security risk class is enabled.'
              : 'Optional. Bounds where the campaign may operate.',
            body: `
              <select id="cf-scopeId" data-cf="scopeId" class="${scopeNeeded ? 'cf-error' : ''}">
                <option value="">— no scope —</option>
                ${scopes.map(scopeOpt).join('')}
              </select>`,
          })}

          ${renderField({
            id: 'cf-profileId', label: 'Prompt profile',
            hint: 'Optional. Locks the prompt persona used by child workers.',
            body: `
              <select id="cf-profileId" data-cf="profileId">
                <option value="">— default —</option>
                ${profiles.map(profileOpt).join('')}
              </select>`,
          })}

          ${renderField({
            id: 'cf-risks', label: 'Allowed risk classes',
            hint: 'Anything you don’t tick goes into the blocked list. Exploit + destructive are locked.',
            body: renderRiskGrid({
              allowed: state.riskBudget.allowedRiskClasses,
              blocked: state.riskBudget.blockedRiskClasses,
            }),
          })}
        </section>

        <section class="cf-section">
          <h3 class="cf-section-title">Tools &amp; worker</h3>

          ${renderField({
            id: 'cf-toolpacks', label: 'Toolpacks',
            hint: `${state.toolpackIds.length} selected. Click to toggle.`,
            body: renderChipPicker({
              id: 'cf-toolpacks', name: 'toolpacks',
              values: state.toolpackIds,
              options: toolpacks.map((t) => ({
                id: t.id, label: t.name || t.id, risks: t.risks || [],
              })),
            }),
          })}

          ${renderField({
            id: 'cf-backend', label: 'Worker backend',
            hint: backendDisabled['codex-exec']
              ? 'codex-exec is unavailable (codex CLI not on PATH).'
              : 'Pick how each child run is executed.',
            body: renderSegmented({
              id: 'cf-backend', name: 'backend', value: state.backend,
              disabled: backendDisabled,
              options: [
                { value: 'phantom-native', label: 'phantom-native', sub: 'In-process · default' },
                { value: 'codex-exec',     label: 'codex-exec',     sub: 'Codex CLI · sandboxed' },
              ],
            }),
          })}

          <div class="cf-field cf-field-workdir" ${showWorkdir ? '' : 'hidden'}>
            <label class="cf-lbl" for="cf-workdir">Codex working directory</label>
            <input type="text" id="cf-workdir" data-cf="workdir"
                   placeholder="/workspace/lab"
                   value="${esc(state.workdir || '')}" />
            <small class="cf-hint">Filesystem writes are confined here via <code>--sandbox workspace-write</code>.</small>
          </div>
        </section>

        <section class="cf-section">
          <h3 class="cf-section-title">Budgets</h3>
          <div class="cf-grid-3">
            ${renderField({
              id: 'cf-maxChildRuns', label: 'Max child runs',
              body: `<input type="number" min="1" max="100" id="cf-maxChildRuns"
                            data-cf="runBudget.maxChildRuns" value="${esc(state.runBudget.maxChildRuns)}" />`,
            })}
            ${renderField({
              id: 'cf-maxAttempts', label: 'Attempts / goal',
              body: `<input type="number" min="1" max="10" id="cf-maxAttempts"
                            data-cf="runBudget.maxAttemptsPerGoal" value="${esc(state.runBudget.maxAttemptsPerGoal)}" />`,
            })}
            ${renderField({
              id: 'cf-maxMinutes', label: 'Wall-clock cap (min)',
              body: `<input type="number" min="5" max="1440" id="cf-maxMinutes"
                            data-cf="runBudget.maxWallClockMinutes" value="${esc(state.runBudget.maxWallClockMinutes)}" />`,
            })}
          </div>
          <div class="cf-toggle-row">
            <label class="cf-toggle">
              <input type="checkbox" data-cf="riskBudget.pauseOnNewFinding"
                ${state.riskBudget.pauseOnNewFinding ? 'checked' : ''}>
              <span>Pause on new finding</span>
            </label>
            <label class="cf-toggle">
              <input type="checkbox" data-cf="riskBudget.pauseOnApprovalRequired"
                ${state.riskBudget.pauseOnApprovalRequired ? 'checked' : ''}>
              <span>Pause on approval-required action</span>
            </label>
          </div>
        </section>

        <section class="cf-section cf-section-preview">
          <h3 class="cf-section-title">Initial goal preview</h3>
          <small class="cf-hint">PHANTOM derives a first goal from the objective so you can sanity-check the prompt before saving. Edit later via <code>POST /api/campaigns/:id/goals</code>.</small>
          <pre class="cf-prompt-preview" id="cf-prompt-preview">${esc(generatePromptPreview(state, refs))}</pre>
        </section>
      </form>
    `;
  }

  function validate(state) {
    const errors = {};
    if (!state.title || !state.title.trim()) errors.title = 'Title is required.';
    if (!state.objective || !state.objective.trim()) errors.objective = 'Objective is required.';
    const allowed = state.riskBudget?.allowedRiskClasses || [];
    const wantsScopedRisk = allowed.some((c) => SCOPE_REQUIRED.has(c));
    if (wantsScopedRisk && !state.scopeId) {
      errors.scopeId = 'Scope is required when network / security risk classes are enabled.';
    }
    if (state.backend === 'codex-exec' && !state.workdir) {
      errors.workdir = 'Codex working directory is required for codex-exec.';
    }
    const rb = state.runBudget || {};
    if (!Number.isInteger(+rb.maxChildRuns) || +rb.maxChildRuns < 1) {
      errors.maxChildRuns = 'Max child runs must be a positive integer.';
    }
    return { ok: Object.keys(errors).length === 0, errors };
  }

  function generatePromptPreview(state, refs = {}) {
    const scopeName = (refs.scopes || []).find((s) => s.id === state.scopeId)?.name;
    const tps = state.toolpackIds.length ? state.toolpackIds.join(', ') : 'none';
    const allowed = state.riskBudget.allowedRiskClasses.join(', ') || 'none';
    const rb = state.runBudget;
    return [
      'You are PHANTOM’s governed security goal supervisor.',
      '',
      'Objective:',
      state.objective || '[ONE-SENTENCE OBJECTIVE]',
      '',
      'Authorized scope:',
      `- Scope: ${scopeName || (state.scopeId || '[SCOPE]')}`,
      `- Allowed risk classes: ${allowed}`,
      `- Blocked unless approved: ${state.riskBudget.blockedRiskClasses.join(', ') || 'none'}`,
      '',
      'Toolpacks:',
      `- ${tps}`,
      '',
      'Budgets:',
      `- Max child runs: ${rb.maxChildRuns}`,
      `- Max attempts per goal: ${rb.maxAttemptsPerGoal}`,
      `- Max wall-clock: ${rb.maxWallClockMinutes} min`,
      `- Pause on new finding: ${state.riskBudget.pauseOnNewFinding ? 'yes' : 'no'}`,
      `- Pause on approval-required: ${state.riskBudget.pauseOnApprovalRequired ? 'yes' : 'no'}`,
      '',
      'Start by decomposing the objective into the smallest useful first goal, then execute only that first goal. After the child run, evaluate whether to continue, retry, branch, request approval, pause, or complete.',
    ].join('\n');
  }

  // Build the POST /api/campaigns body from form state.
  function toCreatePayload(state) {
    return {
      title: state.title.trim(),
      objective: state.objective.trim(),
      scopeId: state.scopeId || null,
      promptProfileId: state.profileId || null,
      toolpackIds: state.toolpackIds.slice(),
      workerBackend: state.backend,
      runBudget: {
        maxChildRuns: parseInt(state.runBudget.maxChildRuns, 10) || 10,
        maxAttemptsPerGoal: parseInt(state.runBudget.maxAttemptsPerGoal, 10) || 2,
        maxWallClockMinutes: parseInt(state.runBudget.maxWallClockMinutes, 10) || 120,
      },
      riskBudget: {
        allowedRiskClasses: state.riskBudget.allowedRiskClasses.slice(),
        blockedRiskClasses: state.riskBudget.blockedRiskClasses.slice(),
        pauseOnNewFinding: !!state.riskBudget.pauseOnNewFinding,
        pauseOnApprovalRequired: !!state.riskBudget.pauseOnApprovalRequired,
      },
      notificationPolicy: state.backend === 'codex-exec' && state.workdir
        ? { workdir: state.workdir }
        : null,
    };
  }

  // Apply a path like 'runBudget.maxChildRuns' to a state object.
  function setField(state, path, value) {
    const parts = path.split('.');
    let cursor = state;
    for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]];
    cursor[parts[parts.length - 1]] = value;
    return state;
  }

  window.CampaignForm = {
    DEFAULT_STATE, getRiskClasses, render, validate,
    generatePromptPreview, toCreatePayload, setField,
    SCOPE_REQUIRED,
  };
})();
