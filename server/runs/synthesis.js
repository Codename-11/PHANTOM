// End-of-run synthesis — the canonical data shape that Phase A renders as
// the synthesis card, Phase B previews in onboarding, and Phase C aggregates
// for posture trending.
//
// This is a pure function: pass in (run, events, artifacts, [replay]) and
// receive a normalized synthesis. The only "magic" is derivation logic, all
// deterministic on the inputs.
//
// Schema (v1):
//   {
//     v: 1,
//     runId, title, status, goal, outcome,
//     startedAt, endedAt, durationMs,
//     scope: { id, name, status, targetCount } | null,
//     objectives: { stated, met: 'met'|'partial'|'unmet'|'unknown', signal },
//     activity: { events, toolCalls: { total, succeeded, failed, blocked },
//                 artifacts, errors },
//     risk: { highest, distribution: { low, med, high, critical },
//             blockedHighRisk },
//     findings: { total, bySeverity: { critical, high, medium, low },
//                 new, resolved },
//     posture: { score, delta, components: { coverage, risk, hygiene },
//                rating: 'strong'|'fair'|'weak'|'unknown' },
//     highlights: [{ kind: 'win'|'risk'|'note', text, refType?, refId? }],
//     nextSteps: [{ kind: 'rerun'|'review'|'remediate'|'expand'|'report',
//                   text, action? }],
//     policy: { mode, approvals: { granted, denied, allowOnce, override,
//               timeout } },
//   }
//
// The `posture.delta` field is filled in when a `previousScore` is provided
// (used by Phase C trending). Otherwise it's null.

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const RISK_ORDER = ['critical', 'high', 'med', 'medium', 'low'];

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round(n) {
  return Math.round(Number.isFinite(n) ? n : 0);
}

function ratingForScore(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 75) return 'strong';
  if (score >= 50) return 'fair';
  return 'weak';
}

function computeDurationMs(run) {
  if (!run?.started_at) return null;
  const start = new Date(run.started_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function highestRisk(distribution) {
  for (const key of ['critical', 'high', 'med', 'medium', 'low']) {
    if ((distribution[key] || 0) > 0) {
      return key === 'med' ? 'medium' : key;
    }
  }
  return 'none';
}

function classifyEvents(events = []) {
  const toolCalls = { total: 0, succeeded: 0, failed: 0, blocked: 0 };
  const riskDistribution = { critical: 0, high: 0, medium: 0, low: 0 };
  const approvals = { granted: 0, denied: 0, allowOnce: 0, override: 0, timeout: 0 };
  const errors = [];
  let blockedHighRisk = 0;
  const seenCallIds = new Set();

  for (const event of events) {
    const type = event.type || '';
    const meta = event.metadata || {};
    const risk = (meta.risk || meta.decision?.risk || '').toLowerCase();
    if (risk) {
      const key = risk === 'med' ? 'medium' : risk;
      if (riskDistribution[key] != null) riskDistribution[key] += 1;
    }

    if (type === 'tool.call.started') {
      const id = meta.toolCallId || event.id;
      if (!seenCallIds.has(id)) {
        seenCallIds.add(id);
        toolCalls.total += 1;
      }
    }
    if (type === 'tool.call.completed') toolCalls.succeeded += 1;
    if (type === 'tool.call.failed' || (type.startsWith('tool.call') && event.status === 'failed')) {
      toolCalls.failed += 1;
      errors.push({ tool: event.tool_name, preview: event.output_preview || '' });
    }
    if (type === 'tool.call.blocked') {
      toolCalls.blocked += 1;
      if (['high', 'critical'].includes(risk)) blockedHighRisk += 1;
    }

    if (type === 'tool.call.approval.granted') {
      if (meta.kind === 'allow-once') approvals.allowOnce += 1;
      else approvals.granted += 1;
    }
    if (type === 'tool.call.approval.denied') {
      if (/timed out/i.test(meta.approval?.note || '')) approvals.timeout += 1;
      else approvals.denied += 1;
    }
    if (type === 'tool.call.allow-once') approvals.allowOnce += 1;
    if (type === 'tool.call.override') approvals.override += 1;
  }

  // If we never saw `tool.call.started`, fall back to terminal events for
  // the total — older traces and tests sometimes only emit completed/failed.
  if (!toolCalls.total) {
    toolCalls.total = toolCalls.succeeded + toolCalls.failed + toolCalls.blocked;
  }

  return { toolCalls, riskDistribution, approvals, errors, blockedHighRisk };
}

function summarizeFindings(findings = []) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  let resolved = 0;
  let openCount = 0;
  for (const finding of findings) {
    const severity = (finding.severity || 'low').toLowerCase();
    const key = SEVERITY_ORDER.includes(severity) ? severity : 'low';
    bySeverity[key] += 1;
    if (finding.status === 'fixed' || finding.status === 'closed' || finding.fixed_at) resolved += 1;
    else openCount += 1;
  }
  return {
    total: findings.length,
    bySeverity,
    new: openCount,
    resolved,
  };
}

// Coverage: % of attempted tool calls that completed successfully.
// Risk: 100 - penalty for each blocked/failed high-or-critical event.
// Hygiene: did the run start and end cleanly? Bonus for artifact output.
function computePosture({ activity, risk, replayComplete, hasArtifacts }) {
  const attempted = activity.toolCalls.total || 0;
  let coverage = 100;
  if (attempted > 0) {
    coverage = (activity.toolCalls.succeeded / attempted) * 100;
  }
  coverage = clamp(coverage, 0, 100);

  const heavyHits = (risk.distribution.critical || 0) + (risk.distribution.high || 0);
  const mediumHits = risk.distribution.medium || 0;
  const blockedPenalty = (activity.toolCalls.blocked || 0) * 4;
  const failPenalty = (activity.toolCalls.failed || 0) * 6;
  let riskScore = 100 - (heavyHits * 12) - (mediumHits * 4) - blockedPenalty - failPenalty;
  riskScore = clamp(riskScore, 0, 100);

  let hygiene = 50;
  if (replayComplete) hygiene += 30;
  if (hasArtifacts) hygiene += 20;
  if (activity.errors.length > 3) hygiene -= 20;
  hygiene = clamp(hygiene, 0, 100);

  const score = round(coverage * 0.4 + riskScore * 0.4 + hygiene * 0.2);
  return {
    score,
    components: {
      coverage: round(coverage),
      risk: round(riskScore),
      hygiene: round(hygiene),
    },
    rating: ratingForScore(score),
  };
}

function inferObjective(run, activity) {
  const stated = (run.goal || run.title || '').trim();
  if (!stated) return { stated: '', met: 'unknown', signal: 'No goal recorded' };

  // Heuristic: a goal is "met" if the run terminated as completed AND no
  // unrecovered failures. "Partial" if completed-with-failures. "Unmet"
  // if failed/stopped early.
  if (run.status === 'completed') {
    if (activity.toolCalls.failed === 0 && activity.errors.length === 0) {
      return { stated, met: 'met', signal: 'Run completed without failures.' };
    }
    return {
      stated,
      met: 'partial',
      signal: `Completed with ${activity.toolCalls.failed} failed tool call(s).`,
    };
  }
  if (['failed', 'stopped'].includes(run.status)) {
    return { stated, met: 'unmet', signal: `Run ended early (${run.status}).` };
  }
  return { stated, met: 'unknown', signal: `Run status: ${run.status || 'unknown'}.` };
}

function buildHighlights({ run, activity, findings, posture, artifacts }) {
  const out = [];

  // Wins first.
  if (activity.toolCalls.succeeded > 0) {
    out.push({
      kind: 'win',
      text: `${activity.toolCalls.succeeded} tool call${activity.toolCalls.succeeded === 1 ? '' : 's'} completed successfully.`,
    });
  }
  if (artifacts.length > 0) {
    out.push({
      kind: 'win',
      text: `${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'} captured for replay & audit.`,
    });
  }
  if (findings && findings.resolved > 0) {
    out.push({
      kind: 'win',
      text: `${findings.resolved} finding${findings.resolved === 1 ? '' : 's'} resolved during this run.`,
    });
  }

  // Risks/notes.
  if (activity.toolCalls.blocked > 0) {
    out.push({
      kind: 'risk',
      text: `${activity.toolCalls.blocked} action${activity.toolCalls.blocked === 1 ? '' : 's'} blocked by scope policy.`,
    });
  }
  if (findings && (findings.bySeverity.critical + findings.bySeverity.high) > 0) {
    const high = findings.bySeverity.critical + findings.bySeverity.high;
    out.push({
      kind: 'risk',
      text: `${high} high-severity finding${high === 1 ? '' : 's'} need triage.`,
    });
  }
  if (activity.toolCalls.failed > 0) {
    out.push({
      kind: 'note',
      text: `${activity.toolCalls.failed} tool call${activity.toolCalls.failed === 1 ? '' : 's'} failed — review trace for cause.`,
    });
  }
  if (run.status === 'failed' || run.status === 'stopped') {
    out.push({
      kind: 'risk',
      text: `Run did not complete cleanly (status: ${run.status}).`,
    });
  }
  if (!out.length) {
    out.push({ kind: 'note', text: 'Run completed with no notable activity.' });
  }
  return out.slice(0, 6);
}

function buildNextSteps({ run, activity, findings, artifacts }) {
  const steps = [];

  if (run.status === 'completed' && activity.toolCalls.failed === 0) {
    steps.push({
      kind: 'rerun',
      text: 'Re-run after mitigation to verify fixes hold.',
      action: 'rerun',
    });
  }
  if (activity.toolCalls.blocked > 0) {
    steps.push({
      kind: 'review',
      text: 'Review blocked actions — adjust scope or operator override if intentional.',
      action: 'review-approvals',
    });
  }
  if (findings && (findings.bySeverity.critical + findings.bySeverity.high) > 0) {
    steps.push({
      kind: 'remediate',
      text: 'Triage high-severity findings before next engagement.',
      action: 'review-findings',
    });
  }
  if (artifacts.length > 0) {
    steps.push({
      kind: 'report',
      text: 'Generate executive summary & evidence bundle for hand-off.',
      action: 'summary',
    });
  }
  if (activity.toolCalls.failed > 0) {
    steps.push({
      kind: 'review',
      text: 'Inspect failed tool calls in the trace timeline.',
      action: 'review-trace',
    });
  }
  if (!steps.length) {
    steps.push({
      kind: 'expand',
      text: 'Run looked uneventful — consider broadening scope or toolpacks.',
      action: 'edit-scope',
    });
  }
  return steps.slice(0, 5);
}

function buildOutcome(run, activity, posture) {
  const status = run.status || 'unknown';
  const succeeded = activity.toolCalls.succeeded;
  const blocked = activity.toolCalls.blocked;
  const failed = activity.toolCalls.failed;
  const bits = [];
  if (status === 'completed') bits.push('Completed');
  else if (status === 'failed') bits.push('Failed');
  else if (status === 'stopped') bits.push('Stopped');
  else bits.push(status.charAt(0).toUpperCase() + status.slice(1));
  if (succeeded) bits.push(`${succeeded} ok`);
  if (failed) bits.push(`${failed} failed`);
  if (blocked) bits.push(`${blocked} blocked`);
  bits.push(`posture ${posture.score}/100 (${posture.rating})`);
  return bits.join(' · ');
}

export function buildRunSynthesis({
  run,
  events = [],
  artifacts = [],
  findings = [],
  replay = null,
  previousScore = null,
  policyMode = null,
} = {}) {
  if (!run || !run.id) {
    throw new Error('buildRunSynthesis requires a run with an id');
  }

  const classified = classifyEvents(events);
  const findingSummary = summarizeFindings(findings);

  const activity = {
    events: events.length,
    toolCalls: classified.toolCalls,
    artifacts: artifacts.length,
    errors: classified.errors,
  };

  const risk = {
    highest: highestRisk(classified.riskDistribution),
    distribution: classified.riskDistribution,
    blockedHighRisk: classified.blockedHighRisk,
  };

  const replayComplete = !!(replay && replay.complete);
  const posture = computePosture({
    activity,
    risk,
    replayComplete,
    hasArtifacts: artifacts.length > 0,
  });
  if (previousScore != null && Number.isFinite(previousScore)) {
    posture.delta = posture.score - previousScore;
  } else {
    posture.delta = null;
  }

  const objectives = inferObjective(run, activity);
  const highlights = buildHighlights({ run, activity, findings: findingSummary, posture, artifacts });
  const nextSteps = buildNextSteps({ run, activity, findings: findingSummary, artifacts });
  const outcome = buildOutcome(run, activity, posture);

  const resolvedPolicyMode = policyMode
    || run.prompt_snapshot?.governance?.policyMode
    || run.promptSnapshot?.governance?.policyMode
    || 'governed';

  return {
    v: 1,
    runId: run.id,
    title: run.title || run.goal || 'Untitled run',
    status: run.status || 'unknown',
    goal: run.goal || null,
    outcome,
    startedAt: run.started_at || null,
    endedAt: run.ended_at || null,
    durationMs: computeDurationMs(run),
    scope: run.scope
      ? {
          id: run.scope.id,
          name: run.scope.name,
          status: run.scope.archived_at ? 'archived' : 'active',
          expiresAt: run.scope.expires_at || null,
        }
      : null,
    objectives,
    activity,
    risk,
    findings: findingSummary,
    posture,
    highlights,
    nextSteps,
    policy: {
      mode: resolvedPolicyMode,
      approvals: classified.approvals,
    },
  };
}

// ─── LLM enrichment (feature-flagged) ────────────────────────────────────
//
// When the settings flag `synthesis_llm_enabled` is on, we ask the
// configured model to rewrite `highlights[]` and `nextSteps[]` based on
// the actual run trace — turning the heuristic summary into operator-
// specific guidance. The data SHAPE (v1) is preserved: only the content
// inside those two arrays changes. The numbers (posture, activity,
// findings, risk) come from the heuristic builder and are unchanged so
// downstream consumers (trending dashboard) keep working.
//
// On any failure (LLM down, JSON parse error, validation fail) the
// original heuristic synthesis is returned unchanged. The agent's
// stability never depends on the enrichment call succeeding.

const ALLOWED_HIGHLIGHT_KINDS = new Set(['win', 'risk', 'note']);
const ALLOWED_NEXT_KINDS = new Set(['rerun', 'review', 'remediate', 'expand', 'report']);
const ALLOWED_NEXT_ACTIONS = new Set([
  'rerun', 'summary', 'review-trace', 'review-approvals',
  'review-findings', 'edit-scope', null, undefined,
]);

function buildEnrichmentPrompt(synthesis, events) {
  const recent = (events || [])
    .filter(e => /^(tool\.call\.|run\.|artifact\.|assistant\.thought)/.test(e.type || ''))
    .slice(-20)
    .map(e => `#${e.seq} ${e.type}${e.tool_name ? ` ${e.tool_name}` : ''}${e.output_preview ? `: ${String(e.output_preview).slice(0, 200)}` : ''}`)
    .join('\n');
  return `Goal: ${synthesis.goal || synthesis.title}
Status: ${synthesis.status}
Scope: ${synthesis.scope?.name || 'none'}
Activity: ${synthesis.activity.toolCalls.total} tool calls (${synthesis.activity.toolCalls.succeeded} ok, ${synthesis.activity.toolCalls.failed} failed, ${synthesis.activity.toolCalls.blocked} blocked); ${synthesis.activity.artifacts} artifacts.
Findings: ${synthesis.findings.total} total (crit: ${synthesis.findings.bySeverity.critical}, high: ${synthesis.findings.bySeverity.high}, med: ${synthesis.findings.bySeverity.medium}, low: ${synthesis.findings.bySeverity.low}); ${synthesis.findings.resolved} resolved.
Posture: ${synthesis.posture.score}/100 (${synthesis.posture.rating}).

Recent trace events:
${recent || '(none)'}`;
}

const ENRICHMENT_SYSTEM_PROMPT = `You are PHANTOM's end-of-run synthesizer.
Read the run summary + trace below and emit JSON describing what mattered
and what the operator should do next. Be specific to THIS run — name the
target, the tool, the failure mode. Avoid generic statements.

Return JSON only, matching this exact shape:
{
  "highlights": [
    { "kind": "win|risk|note", "text": "..." }
  ],
  "nextSteps": [
    { "kind": "rerun|review|remediate|expand|report",
      "text": "...",
      "action": "rerun|summary|review-trace|review-approvals|review-findings|edit-scope" }
  ]
}

Rules:
- 3-5 highlights, 2-5 next steps.
- Highlights: lead with wins, then risks, then notes. Each ≤ 110 chars.
- Next-step "action" must be one of the listed enum values (or omitted).
- Be concrete: cite the tool by name, the host/path involved, the specific failure.
- Don't restate the numbers — the card already shows them.`;

function validateEnrichment(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const highlights = Array.isArray(payload.highlights) ? payload.highlights : [];
  const nextSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];

  const cleanHighlights = highlights
    .filter(h => h && typeof h.text === 'string' && h.text.trim())
    .map(h => ({
      kind: ALLOWED_HIGHLIGHT_KINDS.has(h.kind) ? h.kind : 'note',
      text: String(h.text).slice(0, 160),
    }))
    .slice(0, 6);

  const cleanNextSteps = nextSteps
    .filter(s => s && typeof s.text === 'string' && s.text.trim())
    .map(s => ({
      kind: ALLOWED_NEXT_KINDS.has(s.kind) ? s.kind : 'review',
      text: String(s.text).slice(0, 200),
      action: ALLOWED_NEXT_ACTIONS.has(s.action) ? s.action : null,
    }))
    .slice(0, 5);

  // If both arrays end up empty after validation the LLM didn't give us
  // anything usable — caller should fall back to the heuristic synthesis.
  if (!cleanHighlights.length && !cleanNextSteps.length) return null;
  return { highlights: cleanHighlights, nextSteps: cleanNextSteps };
}

/**
 * Enrich a heuristic synthesis with LLM-generated highlights + nextSteps.
 * Dependency-injected llmCompleteJson so tests can pass a stub.
 *
 * Returns the original synthesis unchanged when:
 *   - the LLM call throws
 *   - validation fails
 *   - both output arrays are empty after validation
 */
export async function enrichSynthesisWithLLM(synthesis, events = [], { llmCompleteJson, abortSignal } = {}) {
  if (typeof llmCompleteJson !== 'function') return synthesis;
  try {
    const user = buildEnrichmentPrompt(synthesis, events);
    const payload = await llmCompleteJson({
      system: ENRICHMENT_SYSTEM_PROMPT,
      user,
      maxTokens: 800,
      abortSignal,
    });
    const validated = validateEnrichment(payload);
    if (!validated) return synthesis;
    return {
      ...synthesis,
      highlights: validated.highlights.length ? validated.highlights : synthesis.highlights,
      nextSteps: validated.nextSteps.length ? validated.nextSteps : synthesis.nextSteps,
      enrichment: { source: 'llm', generatedAt: new Date().toISOString() },
    };
  } catch {
    return synthesis;
  }
}

// Stub synthesis used by the onboarding wizard's "what you'll see when a
// run finishes" preview, and by trending placeholders before any runs exist.
// Same shape, hand-tuned numbers.
export function buildStubSynthesis({ scopeName = 'Lab/internal', target = 'lab.local/24' } = {}) {
  return {
    v: 1,
    runId: 'preview-run',
    title: `Recon ${target}`,
    status: 'completed',
    goal: `Sweep ${target} for exposed services and open findings.`,
    outcome: 'Completed · 7 ok · 1 blocked · posture 72/100 (fair)',
    startedAt: null,
    endedAt: null,
    durationMs: 4 * 60_000,
    scope: { id: 'preview-scope', name: scopeName, status: 'active', expiresAt: null },
    objectives: { stated: `Sweep ${target}`, met: 'partial', signal: 'Completed with 1 blocked action.' },
    activity: {
      events: 42,
      toolCalls: { total: 8, succeeded: 7, failed: 0, blocked: 1 },
      artifacts: 3,
      errors: [],
    },
    risk: {
      highest: 'medium',
      distribution: { critical: 0, high: 1, medium: 3, low: 5 },
      blockedHighRisk: 1,
    },
    findings: {
      total: 4,
      bySeverity: { critical: 0, high: 1, medium: 2, low: 1 },
      new: 4,
      resolved: 0,
    },
    posture: {
      score: 72,
      delta: null,
      components: { coverage: 87, risk: 64, hygiene: 70 },
      rating: 'fair',
    },
    highlights: [
      { kind: 'win', text: '7 tool calls completed successfully.' },
      { kind: 'win', text: '3 artifacts captured for replay & audit.' },
      { kind: 'risk', text: '1 action blocked by scope policy.' },
      { kind: 'risk', text: '1 high-severity finding needs triage.' },
    ],
    nextSteps: [
      { kind: 'rerun', text: 'Re-run after mitigation to verify fixes hold.', action: 'rerun' },
      { kind: 'remediate', text: 'Triage the high-severity finding before next engagement.', action: 'review-findings' },
      { kind: 'report', text: 'Generate executive summary & evidence bundle for hand-off.', action: 'summary' },
    ],
    policy: {
      mode: 'governed',
      approvals: { granted: 1, denied: 0, allowOnce: 0, override: 0, timeout: 0 },
    },
  };
}
