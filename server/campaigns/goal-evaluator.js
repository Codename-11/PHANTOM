// Goal evaluator — decides what happens after a campaign goal's child
// run finishes. Pure function of (goal, runSummary, budgetState, policy).
//
// Returns the canonical evaluator schema from the engineering plan
// (docs/plans/2026-05-20-phantom-goal-engine-plan.md):
//
//   {
//     decision: 'continue' | 'retry' | 'branch' | 'next_goal' |
//               'needs_approval' | 'complete' | 'fail' | 'pause',
//     confidence: number,
//     summary: string,
//     evidence: string[],
//     newGoals: [{title, prompt, priority, completionCriteria}],
//     approvalRequest: {riskClass, target, reason, proposedAction} | null,
//     stopReason: string | null,
//   }
//
// v1 is deterministic. LLM enrichment is deferred to a follow-up patch
// behind a setting flag, mirroring the synthesis_llm_enabled pattern.

const DEFAULTS = {
  confidence: 0.55,
};

/**
 * Build a runSummary the evaluator can read. Caller can construct this
 * from PHANTOM's existing synthesis output + trace event counts +
 * findings. We don't read the DB here — the evaluator stays pure.
 *
 * Expected shape:
 *   {
 *     run: { id, status, started_at, ended_at },
 *     toolCalls: { total, succeeded, failed, blocked },
 *     blockedEvents: [{ toolName, riskClass, reason, target }],
 *     artifacts: [{ id, type }],
 *     findings: [{ id, severity }],
 *     errors: [{ tool, preview }],
 *   }
 */
export function evaluateGoal({ goal, runSummary, riskBudget, runBudget, totalRunsSoFar = 0 }) {
  const out = {
    decision: 'continue',
    confidence: DEFAULTS.confidence,
    summary: '',
    evidence: [],
    newGoals: [],
    approvalRequest: null,
    stopReason: null,
  };

  if (!runSummary) {
    out.decision = 'fail';
    out.summary = 'evaluator received no run summary';
    out.stopReason = 'missing-run-summary';
    return out;
  }

  const policy = {
    pauseOnNewFinding: riskBudget?.pauseOnNewFinding !== false,
    pauseOnApprovalRequired: riskBudget?.pauseOnApprovalRequired !== false,
  };
  const budget = {
    maxChildRuns: runBudget?.maxChildRuns ?? 10,
    maxAttemptsPerGoal: runBudget?.maxAttemptsPerGoal ?? 2,
  };

  const toolCalls = runSummary.toolCalls || {};
  const blockedEvents = Array.isArray(runSummary.blockedEvents) ? runSummary.blockedEvents : [];
  const artifacts = Array.isArray(runSummary.artifacts) ? runSummary.artifacts : [];
  const findings = Array.isArray(runSummary.findings) ? runSummary.findings : [];
  const errors = Array.isArray(runSummary.errors) ? runSummary.errors : [];
  const attemptCount = goal?.attempt_count ?? 0;

  // 1. Blocked tool call → needs_approval (high priority — overrides everything else).
  //    The first blocked event with a recognizable risk class drives the
  //    approvalRequest payload so the operator sees the specifics rather
  //    than a generic "blocked" message.
  if (blockedEvents.length > 0) {
    const first = blockedEvents[0];
    out.decision = 'needs_approval';
    out.summary = `Run produced ${blockedEvents.length} blocked action${blockedEvents.length === 1 ? '' : 's'}; awaiting operator approval.`;
    out.approvalRequest = {
      riskClass: first.riskClass || 'unknown',
      target: first.target || '',
      reason: first.reason || 'policy gate triggered',
      proposedAction: first.toolName || 'blocked action',
    };
    out.confidence = 0.9;
    return out;
  }

  // 2. New finding(s) → complete or pause depending on policy.
  //    A finding is the strongest positive signal in this codebase
  //    (operators run campaigns to surface them).
  if (findings.length > 0) {
    if (policy.pauseOnNewFinding) {
      out.decision = 'pause';
      out.summary = `Run produced ${findings.length} finding${findings.length === 1 ? '' : 's'}; pausing for operator review (pauseOnNewFinding=true).`;
      out.stopReason = 'new-finding';
    } else {
      out.decision = 'complete';
      out.summary = `Run produced ${findings.length} finding${findings.length === 1 ? '' : 's'}; goal complete.`;
    }
    out.evidence = findings.map((f) => `finding:${f.id}`);
    if (artifacts.length) {
      out.evidence.push(...artifacts.map((a) => `artifact:${a.id}`));
    }
    out.confidence = 0.85;
    return out;
  }

  // 3. Budget exhausted → pause or fail.
  if (totalRunsSoFar >= budget.maxChildRuns) {
    out.decision = 'pause';
    out.summary = `Campaign reached maxChildRuns=${budget.maxChildRuns}; pausing.`;
    out.stopReason = 'max-child-runs';
    out.confidence = 0.8;
    return out;
  }
  if (attemptCount + 1 >= budget.maxAttemptsPerGoal && artifacts.length === 0) {
    out.decision = 'fail';
    out.summary = `Goal exhausted ${budget.maxAttemptsPerGoal} attempts without producing artifacts or findings; failing.`;
    out.stopReason = 'max-attempts-no-progress';
    out.confidence = 0.7;
    return out;
  }

  // 4. Run failed at the runtime level → retry if attempts remain.
  if (runSummary.run?.status === 'failed' || errors.length > 0) {
    if (attemptCount + 1 < budget.maxAttemptsPerGoal) {
      out.decision = 'retry';
      out.summary = `Run failed (${errors.length} error${errors.length === 1 ? '' : 's'}); retrying — attempt ${attemptCount + 2}/${budget.maxAttemptsPerGoal}.`;
      out.confidence = 0.5;
      return out;
    }
    out.decision = 'fail';
    out.summary = `Run failed and no attempts remain.`;
    out.stopReason = 'failed-no-attempts-left';
    out.confidence = 0.65;
    return out;
  }

  // 5. Artifacts produced but no findings → branch into a follow-up goal
  //    that examines the artifacts. Otherwise mark complete with low
  //    confidence (the operator can rerun if they want more).
  if (artifacts.length > 0) {
    out.decision = 'complete';
    out.summary = `Run produced ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'} but no findings.`;
    out.evidence = artifacts.map((a) => `artifact:${a.id}`);
    out.confidence = 0.6;
    return out;
  }

  // 6. No artifacts, no findings, no errors, no blocks → retry if
  //    attempts remain, otherwise fail-quiet.
  if (attemptCount + 1 < budget.maxAttemptsPerGoal) {
    out.decision = 'retry';
    out.summary = `No progress this run (${toolCalls.total || 0} tool calls); retrying.`;
    out.confidence = 0.45;
    return out;
  }
  out.decision = 'fail';
  out.summary = `No progress after ${budget.maxAttemptsPerGoal} attempts.`;
  out.stopReason = 'no-progress';
  out.confidence = 0.55;
  return out;
}

/**
 * Helper: build a runSummary from PHANTOM's existing run, events,
 * artifacts, and findings stores. Keeps the evaluator pure while
 * giving callers an easy on-ramp.
 */
export function summarizeRunForEvaluator({ run, events = [], artifacts = [], findings = [] }) {
  const toolCalls = { total: 0, succeeded: 0, failed: 0, blocked: 0 };
  const blockedEvents = [];
  const errors = [];
  for (const ev of events) {
    const t = ev.type || '';
    if (t === 'tool.call.started') toolCalls.total += 1;
    if (t === 'tool.call.completed') toolCalls.succeeded += 1;
    if (t === 'tool.call.failed') {
      toolCalls.failed += 1;
      errors.push({ tool: ev.tool_name, preview: ev.output_preview || '' });
    }
    if (t === 'tool.call.blocked') {
      toolCalls.blocked += 1;
      const meta = ev.metadata || {};
      blockedEvents.push({
        toolName: ev.tool_name,
        riskClass: meta.risk || meta.decision?.risk || 'unknown',
        reason: meta.reason || meta.decision?.reason || '',
        target: meta.target || '',
      });
    }
  }
  return {
    run: {
      id: run?.id,
      status: run?.status,
      started_at: run?.started_at,
      ended_at: run?.ended_at,
    },
    toolCalls,
    blockedEvents,
    artifacts: artifacts.map((a) => ({ id: a.id, type: a.type })),
    findings: findings.map((f) => ({ id: f.id, severity: f.severity })),
    errors,
  };
}
