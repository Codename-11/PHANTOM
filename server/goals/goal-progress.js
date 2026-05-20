// Synthesis-time goal progress.
//
// When a run finalizes (the three terminal branches in server/index.js),
// if the run is linked to a goal, we append an auto-generated progress
// note summarizing the outcome and compute a heuristic satisfaction
// score. Status transitions stay operator-driven — this never closes a
// goal on its own.
//
// Heuristic shape is deliberately deterministic so the agent can't game
// it by claiming satisfaction prematurely. LLM-backed enrichment is
// planned behind the `goal_llm_evaluation_enabled` flag (off by
// default) and lands in a follow-up patch.

import { getRun, getTraceEvents, getArtifacts, getSetting } from '../memory/store.js';
import { getGoal, logProgress } from './goal-store.js';
import { buildRunSynthesis } from '../runs/synthesis.js';

/**
 * Heuristic satisfaction score (0-100) for a run against a goal.
 *
 * v1 inputs (all deterministic, no LLM):
 *   - run terminal status: completed=+30, stopped=+10, failed=+0
 *   - posture rating from synthesis: strong=+25, fair=+15, weak=+5
 *   - findings filed in this run (any): +10 once
 *   - tool calls that succeeded vs. blocked: ratio scaled to +0..20
 *   - errors in trace: -10 (capped to score floor 0)
 *
 * Returned as { score, signals } so the auto-progress note can render
 * a one-line breakdown.
 */
export function scoreRunAgainstGoal(run, synthesis) {
  const signals = [];
  let score = 0;

  if (run?.status === 'completed') { score += 30; signals.push('run completed'); }
  else if (run?.status === 'stopped') { score += 10; signals.push('run stopped'); }
  else if (run?.status === 'failed') { signals.push('run failed'); }

  const rating = synthesis?.posture?.rating || 'unknown';
  if (rating === 'strong') { score += 25; signals.push('posture strong'); }
  else if (rating === 'fair') { score += 15; signals.push('posture fair'); }
  else if (rating === 'weak') { score += 5; signals.push('posture weak'); }

  const findings = synthesis?.findings?.total || 0;
  if (findings > 0) { score += 10; signals.push(`${findings} finding${findings === 1 ? '' : 's'}`); }

  const calls = synthesis?.activity?.toolCalls || {};
  const succeeded = calls.succeeded || 0;
  const total = calls.total || 0;
  if (total > 0) {
    const ratio = succeeded / total;
    const bonus = Math.round(ratio * 20);
    score += bonus;
    if (bonus > 0) signals.push(`${succeeded}/${total} tool calls succeeded`);
  }

  const errors = synthesis?.activity?.errors || 0;
  if (errors > 0) { score -= 10; signals.push(`${errors} error${errors === 1 ? '' : 's'}`); }

  return {
    score: Math.max(0, Math.min(100, score)),
    signals,
  };
}

/**
 * Called from server/index.js right after the three terminal-status
 * branches (completeRun / failRun / updateRunStatus('stopped')).
 *
 * Reads the run, its trace + artifacts, computes synthesis, and writes
 * an auto-progress entry to the linked goal — if any. Idempotent in
 * the sense that calling twice for the same run will append two
 * entries (we expect to be called once per terminal transition).
 *
 * Never throws — degrades silently and logs. Run finalization is the
 * hot path; goal-progress is best-effort enrichment.
 */
export function recordRunOutcomeAgainstGoal(runId) {
  try {
    const run = getRun(runId);
    if (!run || !run.goal_id) return null;
    const goal = getGoal(run.goal_id);
    if (!goal) return null;

    let synthesis = null;
    try {
      const events = getTraceEvents(runId, { limit: 1000 });
      const artifacts = getArtifacts({ runId, limit: 100 });
      synthesis = buildRunSynthesis({ run, events, artifacts });
    } catch {
      // Synthesis is optional. If it fails (partial DB, edge case),
      // we still log a minimal auto-progress note based on run.status.
    }

    const { score, signals } = scoreRunAgainstGoal(run, synthesis || {});
    const noteParts = [
      `run ${run.title || run.id.slice(0, 8)} → ${run.status} (score ${score})`,
    ];
    if (signals.length) noteParts.push(signals.slice(0, 3).join(', '));
    const note = noteParts.join(' — ');

    // Auto-progress respects the rate cap. If we're capped, surface
    // nothing to the caller; the cap is the operator's signal that the
    // queue is noisy. Wrap in a try so the cap error doesn't bubble.
    try {
      return logProgress({
        goalId: goal.id,
        note,
        kind: 'auto',
        runId,
      });
    } catch {
      return null;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[goal-progress] recordRunOutcomeAgainstGoal failed:', err.message);
    }
    return null;
  }
}

/**
 * Reserved for the flagged LLM-enrichment path. Currently a no-op
 * shell so the index.js call site can be wired now and enabled
 * later by flipping `goal_llm_evaluation_enabled`. Mirrors the
 * `synthesis_llm_enabled` pattern in synthesis.js.
 */
export function enrichGoalProgressWithLLM(/* progressId, run, synthesis */) {
  const enabled = getSetting('goal_llm_evaluation_enabled', '0') === '1';
  if (!enabled) return null;
  // Hook for future LLM-backed verdict; intentionally not wired yet.
  return null;
}
