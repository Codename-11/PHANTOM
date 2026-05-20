// Campaign goal engine — the orchestrator that picks the next queued
// goal, dispatches to a worker backend, and (after the worker run
// finalizes) runs the evaluator to decide what happens next.
//
// v1 surface is intentionally narrow: a synchronous "spawn one goal run"
// entry point (`runOneGoal`) and a "finalize and evaluate" hook that
// server/index.js calls when a campaign-linked run reaches a terminal
// status. The autonomous loop (pick→run→evaluate→pick) is the next
// step and lands in a follow-up task — for v1 the operator drives the
// next-goal decision from the UI / API.

import {
  getCampaign, getCampaignGoal, listCampaignGoals,
  updateCampaignGoalStatus, recordEvaluatorResult,
  countCampaignRuns, findGoalForRun, updateGoalRunStatus, listGoalRuns,
  updateCampaignStatus,
} from './campaign-store.js';
import {
  getRun, getTraceEvents, getArtifacts, addTraceEvent,
} from '../memory/store.js';
import { getFindings } from '../assets/asset-store.js';
import { evaluateGoal, summarizeRunForEvaluator } from './goal-evaluator.js';
import { spawnGoalRun, BACKEND_ID as PHANTOM_NATIVE } from './worker-backends/phantom-native.js';

const BACKENDS = {
  [PHANTOM_NATIVE]: { spawn: spawnGoalRun },
};

/**
 * Spawn one campaign goal as a child run. Returns the run + the link.
 * Throws on missing campaign/goal, mismatched campaign_id, or unknown
 * worker_backend.
 */
export function runOneGoal({ campaignId, goalId }) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`campaign not found: ${campaignId}`);
  if (campaign.status !== 'running' && campaign.status !== 'draft' && campaign.status !== 'queued') {
    throw new Error(`campaign is ${campaign.status}; cannot spawn new goal runs`);
  }
  const goal = getCampaignGoal(goalId);
  if (!goal || goal.campaign_id !== campaignId) throw new Error(`goal not found: ${goalId}`);
  if (goal.status !== 'queued' && goal.status !== 'blocked') {
    throw new Error(`goal status is ${goal.status}; only queued or blocked goals can be re-spawned`);
  }

  // Run-budget guard: if maxChildRuns is met, the engine refuses.
  const totalRuns = countCampaignRuns(campaignId);
  const maxRuns = campaign.run_budget?.maxChildRuns ?? 10;
  if (totalRuns >= maxRuns) {
    throw new Error(`campaign reached maxChildRuns=${maxRuns}; pause or raise the budget`);
  }

  const backend = BACKENDS[campaign.worker_backend];
  if (!backend) throw new Error(`unsupported worker_backend: ${campaign.worker_backend}`);

  // Hand off to the backend. Returns { run, link, conversationId }.
  return backend.spawn(campaign, goal);
}

/**
 * Called after a campaign-linked PHANTOM run finalizes (completed,
 * failed, stopped). Reads the run's trace/artifacts/findings, runs
 * the evaluator, persists the verdict, and updates the goal/campaign
 * status accordingly.
 *
 * If the run is not linked to a campaign goal, this is a no-op.
 */
export function finalizeRunForCampaign(runId) {
  const link = findGoalForRun(runId);
  if (!link) return null;
  const { campaign, goal } = link;
  const run = getRun(runId);
  if (!run || !campaign || !goal) return null;

  const events = getTraceEvents(runId, { limit: 1000 });
  const artifacts = getArtifacts({ runId, limit: 100 });
  // Findings are filed against runs/scopes; pull anything attached to
  // this specific run for the evaluator's positive signal.
  let findings = [];
  try {
    findings = getFindings({ runId, limit: 100 });
  } catch { findings = []; }

  const runSummary = summarizeRunForEvaluator({ run, events, artifacts, findings });
  const verdict = evaluateGoal({
    goal,
    runSummary,
    riskBudget: campaign.risk_budget,
    runBudget: campaign.run_budget,
    totalRunsSoFar: countCampaignRuns(campaign.id),
  });
  recordEvaluatorResult(goal.id, verdict);

  // Mirror the evaluator decision onto the goal row's status.
  // 'continue' and 'next_goal' don't change this goal's status — the
  // orchestrator can spawn the next queued goal separately.
  const goalStatus = decisionToGoalStatus(verdict.decision);
  if (goalStatus) {
    const stampEnd = ['completed', 'failed', 'skipped'].includes(goalStatus);
    updateCampaignGoalStatus(goal.id, goalStatus, { stampEnd });
  }

  // Mirror onto the campaign too when the verdict warrants it.
  // pause → campaign paused. needs_approval → campaign needs_approval.
  // Other decisions leave campaign status alone so the orchestrator can
  // pick up the next goal.
  if (verdict.decision === 'pause') {
    updateCampaignStatus(campaign.id, 'paused');
  } else if (verdict.decision === 'needs_approval') {
    updateCampaignStatus(campaign.id, 'needs_approval');
  }

  // Update the run link with the run's terminal status so the campaign
  // detail view can see which runs landed where.
  for (const l of listGoalRuns(goal.id)) {
    if (l.run_id === runId) updateGoalRunStatus(l.id, run.status);
  }

  // Persist the evaluator decision into the trace so replay surfaces it.
  addTraceEvent(runId, {
    type: 'goal.evaluated',
    phase: 'general',
    status: verdict.decision === 'fail' ? 'failed' : 'completed',
    outputPreview: `[${verdict.decision}] ${verdict.summary || ''}`.slice(0, 400),
    metadata: { campaignId: campaign.id, goalId: goal.id, verdict },
  });

  return { verdict, goal: getCampaignGoal(goal.id) };
}

function decisionToGoalStatus(decision) {
  switch (decision) {
    case 'complete':       return 'completed';
    case 'fail':           return 'failed';
    case 'needs_approval': return 'needs_approval';
    case 'pause':          return 'blocked';
    case 'retry':          return 'queued'; // re-queued for next pickup
    case 'branch':
    case 'continue':
    case 'next_goal':
    default:               return null;
  }
}

/**
 * Find the next queued goal in a campaign (highest priority, oldest first).
 * Returns null when the queue is drained. The orchestrator pairs this
 * with runOneGoal to advance.
 */
export function nextQueuedGoal(campaignId) {
  const queued = listCampaignGoals(campaignId, { status: 'queued' });
  return queued[0] || null;
}
