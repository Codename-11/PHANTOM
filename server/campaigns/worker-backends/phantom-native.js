// phantom-native worker backend.
//
// Spawns a campaign goal as a normal PHANTOM run record (so existing
// trace, artifact, graph, and replay machinery work unchanged). v1 does
// NOT drive an LLM loop on its own — the chat WS path is still the
// canonical way to execute a run. This backend creates the run row +
// linkage + lifecycle trace events so an external driver (the chat WS,
// or a future autonomous orchestrator) can pick up the goal by id.
//
// Pattern intentionally mirrors the run creation block in
// server/index.js:297 so a later refactor can extract a shared
// startRunFromGoal() helper (called out in Task 6 of the canonical plan).
//
// Trace events emitted:
//   - worker.spawned
//   - goal.started
// Caller (or the run lifecycle) handles goal.completed / goal.failed.

import {
  createRun, addTraceEvent, createConversation,
} from '../../memory/store.js';
import { getScope } from '../../scope/scope-store.js';
import {
  linkGoalRun, updateCampaignGoalStatus, bumpAttemptCount, getCampaignGoal,
} from '../campaign-store.js';
import config from '../../config.js';

/**
 * Create a child run for a campaign goal and link it to the campaign.
 *
 * @param {object} campaign — full campaign record
 * @param {object} goal — full campaign_goals record
 * @returns {{ run, link, conversationId }}
 */
export function spawnGoalRun(campaign, goal) {
  if (!campaign || !goal) throw new Error('campaign and goal are required');
  if (goal.campaign_id !== campaign.id) {
    throw new Error('goal does not belong to the supplied campaign');
  }

  // Each campaign goal gets its own conversation so the chat thread is
  // bounded by the worker and operators can review it independently.
  // The conversation title is the campaign + goal so it surfaces
  // recognizably in the conversations sidebar.
  const conv = createConversation(`[Campaign] ${campaign.title} · ${goal.title}`);

  const run = createRun({
    conversationId: conv.id,
    title: goal.title,
    goal: goal.prompt,
    model: config.api.model,
    providerRoute: config.api.provider || 'custom',
    scopeId: campaign.scope_id || null,
    promptSnapshot: {
      campaign: { id: campaign.id, title: campaign.title, objective: campaign.objective },
      goal: { id: goal.id, title: goal.title },
      worker_backend: 'phantom-native',
      // Resolved scope captured for replay so the snapshot still makes
      // sense after the scope row is edited or archived.
      scope: campaign.scope_id ? scopeSnapshotFor(campaign.scope_id) : null,
    },
  });

  const link = linkGoalRun({
    campaignId: campaign.id,
    goalId: goal.id,
    runId: run.id,
    workerBackend: 'phantom-native',
    status: 'spawned',
  });

  // Lifecycle bookkeeping on the goal row + the trace event log.
  updateCampaignGoalStatus(goal.id, 'running', { stampStart: true });
  bumpAttemptCount(goal.id);

  addTraceEvent(run.id, {
    type: 'worker.spawned',
    phase: 'general',
    status: 'started',
    outputPreview: `phantom-native worker spawned for goal "${goal.title}"`,
    metadata: { campaignId: campaign.id, goalId: goal.id, backend: 'phantom-native' },
  });
  addTraceEvent(run.id, {
    type: 'goal.started',
    phase: 'general',
    status: 'started',
    outputPreview: goal.prompt.slice(0, 200),
    metadata: { campaignId: campaign.id, goalId: goal.id },
  });

  return { run, link, conversationId: conv.id };
}

/**
 * Take a redacted scope summary suitable for the run's promptSnapshot.
 * Falls back to a minimal pointer if the lookup fails.
 */
function scopeSnapshotFor(scopeId) {
  try {
    const s = getScope(scopeId);
    if (!s) return { id: scopeId, name: '(missing)' };
    return {
      id: s.id, name: s.name,
      allowed_actions: s.allowed_actions,
      blocked_actions: s.blocked_actions,
      action_modes: s.action_modes,
      expires_at: s.expires_at,
    };
  } catch {
    return { id: scopeId };
  }
}

/**
 * Detection probe — exists so the goal-engine can ask "is this backend
 * usable?" before selecting it. phantom-native is always usable (it's
 * the in-process default); codex-exec will probe `codex --version`.
 */
export function isAvailable() {
  return true;
}

export const BACKEND_ID = 'phantom-native';
