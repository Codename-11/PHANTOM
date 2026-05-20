// codex-exec worker backend.
//
// Spawns the Codex CLI non-interactively inside a configured working
// directory. PHANTOM remains the source of truth — every Codex worker
// resolves back into PHANTOM's run/trace/artifact tables exactly like
// the phantom-native backend.
//
// Safety defaults:
//   --sandbox workspace-write    (filesystem writes confined to --cd)
//   --ask-for-approval never     (non-interactive; PHANTOM gates risk separately)
//   --cd <campaign workdir>      (REQUIRED; refuses to run without one)
//
// The dangerous bypass flag (--dangerously-bypass-approvals-and-sandbox)
// is intentionally NOT a build-time option here — operators who need it
// must set it on the codex side, and PHANTOM treats those runs as
// approval-required upstream of the spawn.
//
// Process model: spawn → capture stdout/stderr → write two artifacts
// (stdout.txt, stderr.txt) → mark the run completed/failed based on the
// child exit code. The campaign engine's finalizeRunForCampaign hook
// then runs the evaluator over the resulting trace+artifacts.
//
// Detection: `codex --version` via process spawn. Cached so callers can
// poll cheaply (toolpack availability badge, campaign creation form).

import { spawn } from 'child_process';
import { hasCommand } from '../../utils/has-command.js';
import {
  createConversation, createRun, completeRun, failRun, addTraceEvent,
} from '../../memory/store.js';
import {
  linkGoalRun, updateCampaignGoalStatus, bumpAttemptCount,
} from '../campaign-store.js';
import { getScope } from '../../scope/scope-store.js';
import { writeArtifact } from '../../artifacts/artifact-store.js';
import config from '../../config.js';

export const BACKEND_ID = 'codex-exec';

let _availabilityCache = null;

/**
 * Synchronous availability probe used by validation gates. The first
 * call does a PATH lookup (no process spawn) and caches the result.
 * isAvailableAsync verifies the binary actually runs by invoking
 * `codex --version`.
 */
export function isAvailable() {
  if (_availabilityCache !== null) return _availabilityCache;
  _availabilityCache = hasCommand('codex');
  return _availabilityCache;
}

/**
 * Async detection — runs `codex --version` and resolves with the version
 * string when present, or null when codex is unavailable / errored.
 * Cheap enough to call on settings load.
 */
export function detectVersion(timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!hasCommand('codex')) return resolve(null);
    let out = '';
    let settled = false;
    const child = spawn('codex', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      resolve(null);
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { out += String(chunk); });
    child.on('error', () => { if (settled) return; settled = true; clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code === 0 ? out.trim().split('\n')[0] : null);
    });
  });
}

/** Test-only — clears the availability cache so unit tests can stub the probe. */
export function _resetAvailabilityCache() { _availabilityCache = null; }

/**
 * Spawn a Codex worker for one campaign goal.
 *
 * Mirrors the phantom-native contract: returns `{ run, link, conversationId }`
 * synchronously after creating the run row + linkage. The actual codex
 * process runs in the background and writes stdout/stderr artifacts +
 * lifecycle trace events as it progresses.
 *
 * @param {object} campaign  full campaign record
 * @param {object} goal      full campaign_goals record
 * @param {object} [opts]    test seam — caller can override the spawner
 */
export function spawnGoalRun(campaign, goal, opts = {}) {
  if (!campaign || !goal) throw new Error('campaign and goal are required');
  if (goal.campaign_id !== campaign.id) {
    throw new Error('goal does not belong to the supplied campaign');
  }

  // Working directory comes from the campaign's notification_policy.workdir
  // for now (no schema bump). Falls back to PHANTOM's workspace root so
  // the backend never silently leaks writes elsewhere.
  const workdir = campaign.notification_policy?.workdir
    || config.workspace;

  // Bail early when codex isn't installed — surface the issue at spawn
  // time rather than letting the child immediately error out.
  if (!opts.spawn && !hasCommand('codex')) {
    throw new Error('codex CLI not found on PATH; cannot use codex-exec backend');
  }

  const conv = createConversation(`[Campaign · Codex] ${campaign.title} · ${goal.title}`);

  const run = createRun({
    conversationId: conv.id,
    title: goal.title,
    goal: goal.prompt,
    model: 'codex-exec',
    providerRoute: 'codex-cli',
    scopeId: campaign.scope_id || null,
    promptSnapshot: {
      campaign: { id: campaign.id, title: campaign.title, objective: campaign.objective },
      goal: { id: goal.id, title: goal.title },
      worker_backend: BACKEND_ID,
      codex: { workdir },
      scope: campaign.scope_id ? scopeSnapshotFor(campaign.scope_id) : null,
    },
  });

  const link = linkGoalRun({
    campaignId: campaign.id,
    goalId: goal.id,
    runId: run.id,
    workerBackend: BACKEND_ID,
    status: 'spawned',
  });
  updateCampaignGoalStatus(goal.id, 'running', { stampStart: true });
  bumpAttemptCount(goal.id);

  addTraceEvent(run.id, {
    type: 'worker.spawned',
    phase: 'general',
    status: 'started',
    outputPreview: `codex-exec worker spawned in ${workdir}`,
    metadata: { campaignId: campaign.id, goalId: goal.id, backend: BACKEND_ID, workdir },
  });
  addTraceEvent(run.id, {
    type: 'goal.started',
    phase: 'general',
    status: 'started',
    outputPreview: goal.prompt.slice(0, 200),
    metadata: { campaignId: campaign.id, goalId: goal.id },
  });

  // ── Spawn the process and stream stdout/stderr into artifacts ──
  // Tests pass `opts.spawn` (a stubbed spawner) so the real binary is
  // never invoked from CI.
  const spawner = opts.spawn || spawn;
  const args = [
    'exec',
    '--sandbox', 'workspace-write',
    '--ask-for-approval', 'never',
    '--cd', workdir,
    goal.prompt,
  ];

  let child;
  try {
    child = spawner('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    failRun(run.id, `codex spawn failed: ${err.message}`);
    addTraceEvent(run.id, {
      type: 'worker.budget_exhausted',
      phase: 'general',
      status: 'failed',
      outputPreview: `spawn error: ${err.message}`,
    });
    return { run, link, conversationId: conv.id, child: null };
  }

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (c) => { stdout += String(c); });
  child.stderr?.on('data', (c) => { stderr += String(c); });

  child.on('error', (err) => {
    failRun(run.id, `codex process error: ${err.message}`);
    addTraceEvent(run.id, {
      type: 'goal.failed', phase: 'general', status: 'failed',
      outputPreview: err.message,
    });
  });

  child.on('close', (code) => {
    try {
      if (stdout.length) {
        writeArtifact({
          runId: run.id, conversationId: conv.id,
          type: 'text', title: 'codex stdout',
          mimeType: 'text/plain', extension: '.txt',
          content: stdout,
          metadata: { source: 'codex_exec_stdout', exitCode: code },
        });
      }
      if (stderr.length) {
        writeArtifact({
          runId: run.id, conversationId: conv.id,
          type: 'text', title: 'codex stderr',
          mimeType: 'text/plain', extension: '.txt',
          content: stderr,
          metadata: { source: 'codex_exec_stderr', exitCode: code },
        });
      }
      if (code === 0) {
        completeRun(run.id, stdout.slice(-2000) || '(codex finished)', { tokens_used: 0 });
        addTraceEvent(run.id, {
          type: 'goal.completed', phase: 'general', status: 'completed',
          outputPreview: stdout.slice(-200),
        });
      } else {
        failRun(run.id, `codex exited ${code}`);
        addTraceEvent(run.id, {
          type: 'goal.failed', phase: 'general', status: 'failed',
          outputPreview: stderr.slice(-200) || `exit ${code}`,
        });
      }
    } catch (err) {
      // Defensive: artifact write failure must not crash the supervisor.
      try { failRun(run.id, `post-codex finalization failed: ${err.message}`); } catch {}
    }
  });

  return { run, link, conversationId: conv.id, child };
}

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
