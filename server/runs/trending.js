// Posture trending — aggregates the canonical synthesis shape across runs
// so the Dash can show "how is our posture moving?" without re-deriving
// the metric in two places.
//
// Strategy: take the N most recent terminal runs (optionally filtered by
// scope), build a synthesis per run (reusing buildRunSynthesis so the
// numbers exactly match the per-run card), and emit:
//   - sparkline: chronological [{ score, rating, runId, endedAt, title }]
//   - current, baseline, delta (current - baseline)
//   - byScope: scope-aggregated current scores
//   - recentRuns: full synthesis bundles for the timeline list
//
// All derivations live here so the route is a thin wrapper.

import { getRuns, getRun, getTraceEvents, getArtifactsForRun } from '../memory/store.js';
import { getFindings } from '../assets/asset-store.js';
import { artifactToPublic } from '../artifacts/renderers.js';
import { buildRunSynthesis } from './synthesis.js';

function isTerminal(status) {
  return ['completed', 'failed', 'stopped'].includes(status);
}

function fetchRunSynthesis(runId, previousScore = null) {
  const run = getRun(runId);
  if (!run) return null;
  const events = getTraceEvents(runId, { limit: 2000 });
  const artifacts = getArtifactsForRun(runId).map(a => artifactToPublic(a));
  const findings = getFindings({ runId, limit: 200 });
  return buildRunSynthesis({ run, events, artifacts, findings, previousScore });
}

/**
 * Build a posture-trend report for recent runs.
 *
 * @param {object} opts
 * @param {string|null} opts.scopeId  filter to one scope
 * @param {number} opts.limit         max runs to include (default 12)
 * @param {boolean} opts.includeRecentRuns  include full synthesis bundles
 */
export function getPostureTrend({ scopeId = null, limit = 12, includeRecentRuns = true } = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 12, 50));
  // Pull more than `limit` so we can filter out non-terminal runs without
  // ending up short.
  const raw = getRuns({ limit: safeLimit * 3 });
  const terminal = raw
    .filter(r => isTerminal(r.status))
    .filter(r => !scopeId || r.scope_id === scopeId)
    .slice(0, safeLimit);

  // Sort chronologically so deltas read left-to-right (oldest → newest).
  const chronological = terminal.slice().reverse();

  const syntheses = [];
  let previousScore = null;
  for (const run of chronological) {
    const synthesis = fetchRunSynthesis(run.id, previousScore);
    if (!synthesis) continue;
    syntheses.push(synthesis);
    previousScore = synthesis.posture.score;
  }

  const sparkline = syntheses.map(s => ({
    runId: s.runId,
    title: s.title,
    score: s.posture.score,
    rating: s.posture.rating,
    delta: s.posture.delta,
    endedAt: s.endedAt,
    startedAt: s.startedAt,
    status: s.status,
    scope: s.scope?.name || null,
  }));

  const current = sparkline.length ? sparkline[sparkline.length - 1].score : null;
  const baseline = sparkline.length ? sparkline[0].score : null;
  const delta = (current != null && baseline != null) ? current - baseline : null;

  // Aggregate by scope: latest score per scope, and the delta of latest-vs-
  // second-latest within that scope.
  const byScopeMap = new Map();
  for (const s of syntheses) {
    const key = s.scope?.id || '__none';
    const name = s.scope?.name || 'No scope';
    const entry = byScopeMap.get(key) || { scopeId: s.scope?.id || null, name, scores: [], runs: 0 };
    entry.scores.push(s.posture.score);
    entry.runs += 1;
    byScopeMap.set(key, entry);
  }
  const byScope = Array.from(byScopeMap.values()).map(entry => {
    const last = entry.scores[entry.scores.length - 1];
    const prev = entry.scores.length > 1 ? entry.scores[entry.scores.length - 2] : null;
    return {
      scopeId: entry.scopeId,
      name: entry.name,
      current: last,
      delta: prev != null ? last - prev : null,
      runs: entry.runs,
    };
  }).sort((a, b) => (b.runs - a.runs) || ((b.current ?? 0) - (a.current ?? 0)));

  // Render newest-first for the timeline UI list.
  const recentRuns = includeRecentRuns ? syntheses.slice().reverse() : [];

  return {
    v: 1,
    scopeId,
    runsConsidered: syntheses.length,
    current,
    baseline,
    delta,
    sparkline,
    byScope,
    recentRuns,
  };
}
