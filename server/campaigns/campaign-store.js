// Campaign store — the governed multi-run supervisor.
//
// A campaign owns: objective, scope, toolpacks, worker_backend, budgets,
// status, and a queue of child goals (campaign_goals). Each child goal
// spawns one or more PHANTOM runs via a worker backend, linked through
// campaign_goal_runs.
//
// Schema in server/memory/store.js. Plan in
// docs/plans/2026-05-20-phantom-goal-engine-plan.md.
//
// Distinct from server/goals/goal-store.js, which is the v0 single-goal
// context primitive (active goal in the current chat + agent progress
// notes). Campaigns are the v1 governed automation surface.

import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../memory/store.js';

const CAMPAIGN_STATUSES = new Set([
  'draft', 'queued', 'running', 'paused', 'needs_approval',
  'completed', 'failed', 'canceled',
]);
const GOAL_STATUSES = new Set([
  'queued', 'running', 'blocked', 'needs_approval',
  'completed', 'failed', 'skipped',
]);
const WORKER_BACKENDS = new Set(['phantom-native', 'codex-exec', 'codex-goal-experimental']);

const DEFAULT_RUN_BUDGET = {
  maxChildRuns: 10,
  maxAttemptsPerGoal: 2,
  maxWallClockMinutes: 120,
  maxConsecutiveNoProgress: 2,
};

const DEFAULT_RISK_BUDGET = {
  allowedRiskClasses: ['read/local', 'recon', 'network-scan'],
  blockedRiskClasses: ['exploit', 'destructive', 'credentialed', 'online-bruteforce'],
  pauseOnNewFinding: true,
  pauseOnApprovalRequired: true,
};

function parseJSON(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    status: row.status,
    scope_id: row.scope_id || null,
    prompt_profile_id: row.prompt_profile_id || null,
    toolpack_ids: parseJSON(row.toolpack_ids_json, []),
    worker_backend: row.worker_backend,
    risk_budget: parseJSON(row.risk_budget_json, DEFAULT_RISK_BUDGET),
    run_budget: parseJSON(row.run_budget_json, DEFAULT_RUN_BUDGET),
    notification_policy: parseJSON(row.notification_policy_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
  };
}

function normalizeGoal(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    parent_goal_id: row.parent_goal_id || null,
    title: row.title,
    prompt: row.prompt,
    status: row.status,
    priority: row.priority,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    completion_criteria: parseJSON(row.completion_criteria_json, null),
    evaluator_result: parseJSON(row.evaluator_result_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
  };
}

function normalizeRunLink(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    goal_id: row.goal_id,
    run_id: row.run_id,
    worker_backend: row.worker_backend,
    status: row.status,
    created_at: row.created_at,
  };
}

// ── Campaigns ─────────────────────────────────────────────────────────────

export function createCampaign({
  title,
  objective,
  scopeId = null,
  promptProfileId = null,
  toolpackIds = [],
  workerBackend = 'phantom-native',
  riskBudget = null,
  runBudget = null,
  notificationPolicy = null,
}) {
  if (!title || !String(title).trim()) throw new Error('campaign title is required');
  if (!objective || !String(objective).trim()) throw new Error('campaign objective is required');
  if (!WORKER_BACKENDS.has(workerBackend)) {
    throw new Error(`unknown worker_backend: ${workerBackend}`);
  }
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO campaigns (
      id, title, objective, scope_id, prompt_profile_id, toolpack_ids_json,
      worker_backend, risk_budget_json, run_budget_json, notification_policy_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(title).trim(),
    String(objective).trim(),
    scopeId || null,
    promptProfileId || null,
    JSON.stringify(toolpackIds || []),
    workerBackend,
    JSON.stringify({ ...DEFAULT_RISK_BUDGET, ...(riskBudget || {}) }),
    JSON.stringify({ ...DEFAULT_RUN_BUDGET, ...(runBudget || {}) }),
    notificationPolicy ? JSON.stringify(notificationPolicy) : null
  );
  return getCampaign(id);
}

export function getCampaign(id) {
  if (!id) return null;
  return normalizeCampaign(getDB().prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
}

export function listCampaigns({ status = null } = {}) {
  if (status) {
    return getDB().prepare('SELECT * FROM campaigns WHERE status = ? ORDER BY created_at DESC')
      .all(status).map(normalizeCampaign);
  }
  return getDB().prepare('SELECT * FROM campaigns ORDER BY created_at DESC')
    .all().map(normalizeCampaign);
}

export function updateCampaign(id, updates = {}) {
  const current = getCampaign(id);
  if (!current) return null;
  // Budgets shallow-merge: a partial { maxChildRuns: 5 } update preserves
  // wall-clock + risk-class defaults rather than wiping them. Operators
  // shouldn't have to re-specify the full budget to tweak one knob.
  const mergedRunBudget = updates.runBudget !== undefined
    ? { ...current.run_budget, ...updates.runBudget }
    : current.run_budget;
  const mergedRiskBudget = updates.riskBudget !== undefined
    ? { ...current.risk_budget, ...updates.riskBudget }
    : current.risk_budget;

  const next = {
    title: updates.title !== undefined ? String(updates.title).trim() : current.title,
    objective: updates.objective !== undefined ? String(updates.objective).trim() : current.objective,
    scope_id: updates.scopeId !== undefined ? (updates.scopeId || null) : current.scope_id,
    prompt_profile_id: updates.promptProfileId !== undefined
      ? (updates.promptProfileId || null)
      : current.prompt_profile_id,
    toolpack_ids: updates.toolpackIds !== undefined ? updates.toolpackIds : current.toolpack_ids,
    worker_backend: updates.workerBackend !== undefined ? updates.workerBackend : current.worker_backend,
    risk_budget: mergedRiskBudget,
    run_budget: mergedRunBudget,
    notification_policy: updates.notificationPolicy !== undefined
      ? updates.notificationPolicy
      : current.notification_policy,
  };
  if (!next.title) throw new Error('campaign title is required');
  if (!WORKER_BACKENDS.has(next.worker_backend)) {
    throw new Error(`unknown worker_backend: ${next.worker_backend}`);
  }
  getDB().prepare(
    `UPDATE campaigns
     SET title = ?, objective = ?, scope_id = ?, prompt_profile_id = ?,
         toolpack_ids_json = ?, worker_backend = ?,
         risk_budget_json = ?, run_budget_json = ?, notification_policy_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    next.title, next.objective, next.scope_id, next.prompt_profile_id,
    JSON.stringify(next.toolpack_ids || []),
    next.worker_backend,
    JSON.stringify(next.risk_budget || DEFAULT_RISK_BUDGET),
    JSON.stringify(next.run_budget || DEFAULT_RUN_BUDGET),
    next.notification_policy ? JSON.stringify(next.notification_policy) : null,
    id
  );
  return getCampaign(id);
}

export function updateCampaignStatus(id, status, { stampStart = false, stampEnd = false } = {}) {
  if (!CAMPAIGN_STATUSES.has(status)) throw new Error(`unknown campaign status: ${status}`);
  // started_at is sticky — first transition into running sets it. Subsequent
  // pause/resume cycles never overwrite. ended_at is only set when the
  // campaign reaches a terminal state (completed/failed/canceled).
  if (stampStart) {
    getDB().prepare(
      `UPDATE campaigns
       SET status = ?, updated_at = CURRENT_TIMESTAMP,
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
       WHERE id = ?`
    ).run(status, id);
  } else if (stampEnd) {
    getDB().prepare(
      `UPDATE campaigns
       SET status = ?, updated_at = CURRENT_TIMESTAMP,
           ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
       WHERE id = ?`
    ).run(status, id);
  } else {
    getDB().prepare(
      `UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(status, id);
  }
  return getCampaign(id);
}

export function deleteCampaign(id) {
  // ON DELETE CASCADE on campaign_goals + campaign_goal_runs cleans up.
  const info = getDB().prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  return info.changes > 0;
}

// ── Campaign Goals ────────────────────────────────────────────────────────

export function createCampaignGoal({
  campaignId,
  title,
  prompt,
  parentGoalId = null,
  priority = 0,
  maxAttempts = null,
  completionCriteria = null,
}) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`campaign not found: ${campaignId}`);
  if (!title || !String(title).trim()) throw new Error('goal title is required');
  if (!prompt || !String(prompt).trim()) throw new Error('goal prompt is required');
  const id = uuidv4();
  const cap = maxAttempts != null
    ? maxAttempts
    : (campaign.run_budget?.maxAttemptsPerGoal || DEFAULT_RUN_BUDGET.maxAttemptsPerGoal);
  getDB().prepare(
    `INSERT INTO campaign_goals (
      id, campaign_id, parent_goal_id, title, prompt, priority, max_attempts, completion_criteria_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    campaignId,
    parentGoalId || null,
    String(title).trim(),
    String(prompt).trim(),
    parseInt(priority, 10) || 0,
    parseInt(cap, 10),
    completionCriteria ? JSON.stringify(completionCriteria) : null
  );
  return getCampaignGoal(id);
}

export function getCampaignGoal(id) {
  if (!id) return null;
  return normalizeGoal(getDB().prepare('SELECT * FROM campaign_goals WHERE id = ?').get(id));
}

export function listCampaignGoals(campaignId, { status = null } = {}) {
  if (status) {
    return getDB().prepare(
      `SELECT * FROM campaign_goals WHERE campaign_id = ? AND status = ?
       ORDER BY priority DESC, created_at ASC`
    ).all(campaignId, status).map(normalizeGoal);
  }
  return getDB().prepare(
    `SELECT * FROM campaign_goals WHERE campaign_id = ?
     ORDER BY priority DESC, created_at ASC`
  ).all(campaignId).map(normalizeGoal);
}

export function updateCampaignGoalStatus(id, status, { stampStart = false, stampEnd = false } = {}) {
  if (!GOAL_STATUSES.has(status)) throw new Error(`unknown goal status: ${status}`);
  if (stampStart) {
    getDB().prepare(
      `UPDATE campaign_goals
       SET status = ?, updated_at = CURRENT_TIMESTAMP,
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
       WHERE id = ?`
    ).run(status, id);
  } else if (stampEnd) {
    getDB().prepare(
      `UPDATE campaign_goals
       SET status = ?, updated_at = CURRENT_TIMESTAMP,
           ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
       WHERE id = ?`
    ).run(status, id);
  } else {
    getDB().prepare(
      `UPDATE campaign_goals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(status, id);
  }
  return getCampaignGoal(id);
}

export function recordEvaluatorResult(id, evaluatorResult) {
  if (!evaluatorResult) return getCampaignGoal(id);
  getDB().prepare(
    `UPDATE campaign_goals
     SET evaluator_result_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(JSON.stringify(evaluatorResult), id);
  return getCampaignGoal(id);
}

export function bumpAttemptCount(id) {
  getDB().prepare(
    `UPDATE campaign_goals
     SET attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);
  return getCampaignGoal(id);
}

// ── Run Linkage ───────────────────────────────────────────────────────────

export function linkGoalRun({ campaignId, goalId, runId, workerBackend = 'phantom-native', status = 'spawned' }) {
  if (!campaignId || !goalId || !runId) {
    throw new Error('campaignId, goalId, and runId are required');
  }
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO campaign_goal_runs (id, campaign_id, goal_id, run_id, worker_backend, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, campaignId, goalId, runId, workerBackend, status);
  return normalizeRunLink(getDB().prepare('SELECT * FROM campaign_goal_runs WHERE id = ?').get(id));
}

export function updateGoalRunStatus(linkId, status) {
  getDB().prepare(
    `UPDATE campaign_goal_runs SET status = ? WHERE id = ?`
  ).run(status, linkId);
  return normalizeRunLink(getDB().prepare('SELECT * FROM campaign_goal_runs WHERE id = ?').get(linkId));
}

export function listGoalRuns(goalId) {
  return getDB().prepare(
    `SELECT * FROM campaign_goal_runs WHERE goal_id = ? ORDER BY created_at DESC`
  ).all(goalId).map(normalizeRunLink);
}

export function listCampaignRuns(campaignId) {
  return getDB().prepare(
    `SELECT * FROM campaign_goal_runs WHERE campaign_id = ? ORDER BY created_at DESC`
  ).all(campaignId).map(normalizeRunLink);
}

export function countCampaignRuns(campaignId) {
  return getDB().prepare(
    `SELECT COUNT(*) AS n FROM campaign_goal_runs WHERE campaign_id = ?`
  ).get(campaignId).n;
}

// Reverse lookup: given a PHANTOM run id, which campaign goal spawned it?
export function findGoalForRun(runId) {
  const link = getDB().prepare(
    `SELECT * FROM campaign_goal_runs WHERE run_id = ?`
  ).get(runId);
  if (!link) return null;
  return {
    link: normalizeRunLink(link),
    goal: getCampaignGoal(link.goal_id),
    campaign: getCampaign(link.campaign_id),
  };
}
