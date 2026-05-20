// Goal store — persistent multi-step operator objectives.
//
// A goal is distinct from `runs.goal` (a per-run one-liner). It is a
// cross-run intent the agent works against until the operator confirms
// completion. Schema in server/memory/store.js (goals + goal_progress
// tables; runs.goal_id is the link column).
//
// Locked decisions (see docs/plans/2026-05-20-phantom-goal-engine-plan.md):
//   - one active goal at a time, tracked via settings.current_goal_id
//   - status transitions are operator-driven; the agent can only file
//     satisfaction *claims*, never close the row itself
//   - progress notes are rate-limited per 24h to prevent prompt pollution

import { v4 as uuidv4 } from 'uuid';
import { getDB, getSetting, setSetting } from '../memory/store.js';

const CURRENT_GOAL_KEY = 'current_goal_id';
const DEFAULT_DAILY_CAP = 50;
const NOTE_MAX_CHARS = 280;
const VALID_STATUSES = new Set(['active', 'paused', 'completed', 'cancelled']);
const VALID_KINDS = new Set(['step', 'finding', 'blocker', 'pivot', 'auto']);

function parseJSON(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeGoal(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    success_criteria: row.success_criteria,
    scope_id: row.scope_id || null,
    status: row.status,
    satisfied_at: row.satisfied_at,
    satisfaction_claim: parseJSON(row.satisfaction_claim_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    metadata: parseJSON(row.metadata_json, null),
  };
}

function normalizeProgress(row) {
  if (!row) return null;
  return {
    id: row.id,
    goal_id: row.goal_id,
    run_id: row.run_id || null,
    note: row.note,
    kind: row.kind,
    created_at: row.created_at,
  };
}

function trimNote(note) {
  const text = String(note || '').trim();
  if (!text) return '';
  return text.length > NOTE_MAX_CHARS ? text.slice(0, NOTE_MAX_CHARS - 1) + '…' : text;
}

// ─── CRUD ───

export function createGoal({ title, objective, successCriteria, scopeId = null, metadata = null }) {
  if (!title || !String(title).trim()) throw new Error('goal title is required');
  if (!objective || !String(objective).trim()) throw new Error('goal objective is required');
  if (!successCriteria || !String(successCriteria).trim()) throw new Error('goal successCriteria is required');
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO goals (id, title, objective, success_criteria, scope_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(title).trim(),
    String(objective).trim(),
    String(successCriteria).trim(),
    scopeId || null,
    metadata ? JSON.stringify(metadata) : null
  );
  return getGoal(id);
}

export function getGoal(id) {
  if (!id) return null;
  return normalizeGoal(getDB().prepare('SELECT * FROM goals WHERE id = ?').get(id));
}

export function getGoals({ status = 'active' } = {}) {
  if (status === 'all') {
    return getDB().prepare('SELECT * FROM goals ORDER BY created_at DESC').all().map(normalizeGoal);
  }
  return getDB().prepare('SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC').all(status).map(normalizeGoal);
}

export function updateGoal(id, updates = {}) {
  const current = getGoal(id);
  if (!current) return null;
  const next = {
    title: updates.title !== undefined ? String(updates.title).trim() : current.title,
    objective: updates.objective !== undefined ? String(updates.objective).trim() : current.objective,
    success_criteria: updates.successCriteria !== undefined ? String(updates.successCriteria).trim() : current.success_criteria,
    scope_id: updates.scopeId !== undefined ? (updates.scopeId || null) : current.scope_id,
    status: updates.status !== undefined ? updates.status : current.status,
    metadata: updates.metadata !== undefined ? updates.metadata : current.metadata,
  };
  if (!next.title) throw new Error('goal title is required');
  if (!next.objective) throw new Error('goal objective is required');
  if (!next.success_criteria) throw new Error('goal successCriteria is required');
  if (!VALID_STATUSES.has(next.status)) throw new Error(`invalid status: ${next.status}`);
  getDB().prepare(
    `UPDATE goals
     SET title = ?, objective = ?, success_criteria = ?, scope_id = ?, status = ?,
         metadata_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    next.title, next.objective, next.success_criteria, next.scope_id, next.status,
    next.metadata ? JSON.stringify(next.metadata) : null,
    id
  );
  return getGoal(id);
}

export function deleteGoal(id) {
  // ON DELETE CASCADE removes goal_progress rows. runs.goal_id is SET NULL'd
  // implicitly via the column being a soft-ref (no FK on that side).
  const current = getCurrentGoalId();
  if (current === id) clearCurrentGoal();
  getDB().prepare('UPDATE runs SET goal_id = NULL WHERE goal_id = ?').run(id);
  const info = getDB().prepare('DELETE FROM goals WHERE id = ?').run(id);
  return info.changes > 0;
}

// ─── Active-goal pointer ───

export function getCurrentGoalId() {
  return getSetting(CURRENT_GOAL_KEY, null);
}

export function getCurrentGoal() {
  const id = getCurrentGoalId();
  if (!id) return null;
  const goal = getGoal(id);
  // Self-heal: if the row was deleted out from under us, clear the pointer.
  if (!goal) {
    clearCurrentGoal();
    return null;
  }
  return goal;
}

export function activateGoal(id) {
  const goal = getGoal(id);
  if (!goal) return null;
  setSetting(CURRENT_GOAL_KEY, id);
  return goal;
}

export function clearCurrentGoal() {
  getDB().prepare('DELETE FROM settings WHERE key = ?').run(CURRENT_GOAL_KEY);
}

// ─── Status transitions ───

export function completeGoal(id, { note = null } = {}) {
  const goal = getGoal(id);
  if (!goal) return null;
  getDB().prepare(
    `UPDATE goals
     SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);
  if (note) {
    logProgress({ goalId: id, note, kind: 'step' });
  }
  // Active-goal pointer clears so subsequent runs aren't tagged with the
  // completed goal. Operators can re-activate from the UI if they want.
  if (getCurrentGoalId() === id) clearCurrentGoal();
  return getGoal(id);
}

// ─── Progress notes ───

export function logProgress({ goalId, note, kind = 'step', runId = null }) {
  const goal = getGoal(goalId);
  if (!goal) throw new Error(`goal not found: ${goalId}`);
  const trimmed = trimNote(note);
  if (!trimmed) throw new Error('progress note is empty');
  const safeKind = VALID_KINDS.has(kind) ? kind : 'step';

  // Daily rate cap to keep the agent from spamming notes. Counted as
  // entries in the last 24h regardless of kind. Operator can raise via
  // the goal_progress_daily_cap setting.
  const cap = parseInt(getSetting('goal_progress_daily_cap', String(DEFAULT_DAILY_CAP)), 10) || DEFAULT_DAILY_CAP;
  const count = getDB().prepare(
    `SELECT COUNT(*) AS n FROM goal_progress
     WHERE goal_id = ? AND created_at > datetime('now', '-1 day')`
  ).get(goalId).n;
  if (count >= cap) {
    throw new Error(`progress cap reached for goal (${cap}/day) — operator can raise goal_progress_daily_cap`);
  }

  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO goal_progress (id, goal_id, run_id, note, kind)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, goalId, runId || null, trimmed, safeKind);
  return normalizeProgress(getDB().prepare('SELECT * FROM goal_progress WHERE id = ?').get(id));
}

export function getProgress(goalId, { limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 500));
  return getDB().prepare(
    `SELECT * FROM goal_progress WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(goalId, safeLimit).map(normalizeProgress);
}

// ─── Satisfaction claim (agent-side) ───

export function recordSatisfactionClaim(goalId, { justification, confidence = 'medium', runId = null }) {
  const goal = getGoal(goalId);
  if (!goal) throw new Error(`goal not found: ${goalId}`);
  if (!justification || !String(justification).trim()) throw new Error('justification is required');
  const claim = {
    justification: String(justification).trim(),
    confidence,
    run_id: runId || null,
    claimed_at: new Date().toISOString(),
  };
  // Idempotent: subsequent calls overwrite rather than append, per
  // prompt-design guardrail (one claim per goal is the norm).
  getDB().prepare(
    `UPDATE goals
     SET satisfied_at = CURRENT_TIMESTAMP, satisfaction_claim_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(JSON.stringify(claim), goalId);
  return getGoal(goalId);
}

// ─── Linked-run queries ───

export function getLinkedRuns(goalId, { limit = 20 } = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 200));
  return getDB().prepare(
    `SELECT id, title, status, goal, started_at, ended_at, summary
     FROM runs
     WHERE goal_id = ?
     ORDER BY started_at DESC
     LIMIT ?`
  ).all(goalId, safeLimit);
}

export function countLinkedRuns(goalId, { terminalOnly = true } = {}) {
  const sql = terminalOnly
    ? `SELECT COUNT(*) AS n FROM runs WHERE goal_id = ? AND status IN ('completed','failed','stopped')`
    : `SELECT COUNT(*) AS n FROM runs WHERE goal_id = ?`;
  return getDB().prepare(sql).get(goalId).n;
}

export function tagRunWithGoal(runId, goalId) {
  if (!runId || !goalId) return false;
  const info = getDB().prepare('UPDATE runs SET goal_id = ? WHERE id = ?').run(goalId, runId);
  return info.changes > 0;
}
