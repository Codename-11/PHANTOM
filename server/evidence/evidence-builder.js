// Evidence builder — aggregates a run into a single reviewable bundle
// (run, trace, artifacts, findings, prompt + scope snapshots, notes).
//
// Two outputs:
//   buildRunEvidence(runId)        → JSON-ready object (returned by
//                                     GET /api/runs/:id/evidence)
//   renderEvidenceMarkdown(bundle) → operator-readable Markdown
//                                     export (used by POST .../export)
//
// Every output passes through evidence-redactor before serialization
// so secrets never leave the host even if they sneaked into a trace
// preview / artifact metadata / prompt snapshot.

import {
  getRun, getTraceEvents, getArtifactsForRun,
} from '../memory/store.js';
import { getFindings } from '../assets/asset-store.js';
import { getScope } from '../scope/scope-store.js';
import { redact } from './evidence-redactor.js';

const EVENT_LIMIT = 2000;

/**
 * Aggregate a single run's evidence. Returns a redacted bundle —
 * caller does NOT need to redact again.
 *
 * @param {string} runId
 * @param {object} [opts]
 * @param {boolean} [opts.includeRawEvents=true]  include trace event array
 * @returns {{run, scope, promptSnapshot, artifacts, findings, events, summary}}
 */
export function buildRunEvidence(runId, { includeRawEvents = true } = {}) {
  const run = getRun(runId);
  if (!run) throw new Error(`run not found: ${runId}`);

  const events = getTraceEvents(runId, { limit: EVENT_LIMIT }) || [];
  const artifacts = (getArtifactsForRun(runId) || []).map(({ path, ...rest }) => rest);

  let findings = [];
  try { findings = getFindings({ runId, limit: 200 }) || []; }
  catch { findings = []; }

  const blockedEvents = events.filter((ev) => ev.type === 'tool.call.blocked');
  const toolCalls = events.filter((ev) => /^tool\.call/.test(ev.type)).length;
  const errors = events.filter((ev) => ev.status === 'failed' || ev.type === 'run.failed');

  let scope = null;
  if (run.scope_id) {
    try {
      const s = getScope(run.scope_id);
      if (s) {
        scope = {
          id: s.id, name: s.name,
          allowed_actions: s.allowed_actions,
          blocked_actions: s.blocked_actions,
          targets: s.targets,
          expires_at: s.expires_at,
        };
      }
    } catch { scope = { id: run.scope_id }; }
  }

  const promptSnapshot = safeParse(run.prompt_snapshot, null);

  const bundle = {
    run: {
      id: run.id,
      title: run.title,
      goal: run.goal,
      status: run.status,
      model: run.model,
      provider_route: run.provider_route,
      conversation_id: run.conversation_id,
      scope_id: run.scope_id,
      risk_level: run.risk_level,
      started_at: run.started_at,
      ended_at: run.ended_at,
      summary: run.summary || null,
      notes: run.notes || null,
    },
    scope,
    promptSnapshot,
    artifacts,
    findings,
    events: includeRawEvents ? events : null,
    summary: {
      eventCount: events.length,
      toolCalls,
      blockedCount: blockedEvents.length,
      findingCount: findings.length,
      artifactCount: artifacts.length,
      errorCount: errors.length,
    },
    generatedAt: new Date().toISOString(),
  };

  // Redaction is mandatory before any value leaves this module.
  return redact(bundle);
}

function safeParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Render an evidence bundle as Markdown. Output is already redacted
 * (the bundle is redacted upstream).
 */
export function renderEvidenceMarkdown(bundle) {
  const lines = [];
  const r = bundle.run;
  lines.push(`# Run evidence · ${r.title || r.id}`);
  lines.push('');
  if (r.goal) {
    lines.push(`> ${r.goal}`);
    lines.push('');
  }
  lines.push('## Run');
  lines.push('');
  lines.push(`- **ID:** \`${r.id}\``);
  lines.push(`- **Status:** ${r.status}`);
  lines.push(`- **Model:** ${r.model || '—'}`);
  lines.push(`- **Provider route:** ${r.provider_route || '—'}`);
  lines.push(`- **Started:** ${r.started_at || '—'}`);
  lines.push(`- **Ended:** ${r.ended_at || '—'}`);
  lines.push(`- **Risk level:** ${r.risk_level || '—'}`);
  if (r.summary) {
    lines.push('');
    lines.push('### Summary');
    lines.push('');
    lines.push(r.summary);
  }
  lines.push('');
  lines.push('## Scope snapshot');
  lines.push('');
  if (!bundle.scope) {
    lines.push('_No scope attached._');
  } else {
    const s = bundle.scope;
    lines.push(`- **Scope:** ${s.name || '(unnamed)'} (\`${s.id}\`)`);
    if (s.allowed_actions?.length) lines.push(`- **Allowed actions:** ${s.allowed_actions.join(', ')}`);
    if (s.blocked_actions?.length) lines.push(`- **Blocked actions:** ${s.blocked_actions.join(', ')}`);
    if (s.expires_at) lines.push(`- **Expires:** ${s.expires_at}`);
  }
  lines.push('');
  lines.push('## Roll-up');
  lines.push('');
  lines.push(`- **Tool calls:** ${bundle.summary.toolCalls}`);
  lines.push(`- **Blocked actions:** ${bundle.summary.blockedCount}`);
  lines.push(`- **Findings:** ${bundle.summary.findingCount}`);
  lines.push(`- **Artifacts:** ${bundle.summary.artifactCount}`);
  lines.push(`- **Errors:** ${bundle.summary.errorCount}`);
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  if (!bundle.findings.length) {
    lines.push('_No findings recorded._');
  } else {
    lines.push('| Severity | Title | Status |');
    lines.push('| --- | --- | --- |');
    for (const f of bundle.findings) {
      lines.push(`| ${f.severity || '?'} | ${f.title || '(untitled)'} | ${f.status || '?'} |`);
    }
  }
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  if (!bundle.artifacts.length) {
    lines.push('_No artifacts produced._');
  } else {
    for (const a of bundle.artifacts) {
      lines.push(`- \`${a.id}\` · ${a.type || '?'} · ${a.title || '(untitled)'}`);
    }
  }
  if (bundle.promptSnapshot) {
    lines.push('');
    lines.push('## Prompt snapshot');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(bundle.promptSnapshot, null, 2));
    lines.push('```');
  }
  if (r.notes) {
    lines.push('');
    lines.push('## Operator notes');
    lines.push('');
    lines.push(r.notes);
  }
  lines.push('');
  lines.push('---');
  lines.push(`_Generated by PHANTOM evidence-builder · ${bundle.generatedAt} · secrets redacted._`);
  return lines.join('\n');
}
