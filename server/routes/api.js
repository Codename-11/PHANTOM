import { Router } from 'express';
import config, { updateConfig } from '../config.js';
import { resetClient, testConnection, processMessage } from '../ai/llm-client.js';
import { listProvidersPublic, getProvider, DEFAULT_PROVIDER_ID } from '../ai/providers.js';
import {
  createConversation, getConversations, getConversation, deleteConversation,
  updateConversationTitle, getMessages,
  getAllSettings, getSetting, setSetting,
  getAllMemories, searchMemories,
  getMCPServers, addMCPServer, removeMCPServer,
  getRuns, getRun, getTraceEvents,
  getArtifacts, getArtifact, getArtifactsForRun,
  getApprovalEvents, getApprovalStats,
  createInstallRequest, getInstallRequest, getInstallRequests, updateInstallRequest,
} from '../memory/store.js';
import {
  getInstallerStatus,
  resolveInstallPlan,
  summarizePlan,
  toolIdsForTier,
  TIERS,
} from '../tools/installer.js';
import { spawn } from 'child_process';
import { artifactToPublic } from '../artifacts/renderers.js';
import { writeArtifact, exportEvidenceBundle } from '../artifacts/artifact-store.js';
import { renderExecutiveSummary, renderPentestReport } from '../artifacts/report-renderers.js';
import { deriveRunGraph } from '../graph/graph-derive.js';
import { buildSystemPrompt } from '../ai/system-prompt.js';
import { createScope, getScope, getScopes, updateScope, archiveScope } from '../scope/scope-store.js';
import { evaluateToolAction, normalizeOperatorOverride, ACTION_CLASSES } from '../scope/policy.js';
import { parseTargetInput, targetsToScopeFields } from '../scope/target-parser.js';
import { getScopeTemplates } from '../scope/templates.js';
import { getRoeTemplates, getRoeTemplate } from '../scope/roe-templates.js';
import {
  createPromptProfile, getPromptProfiles, getPromptProfile, updatePromptProfile,
  createPromptFragment, getPromptFragments, getPromptFragment, updatePromptFragment,
  resolvePrompt,
} from '../prompts/prompt-store.js';
import { getToolDefinitions } from '../tools/registry.js';
import { getToolpacks, getToolpack, checkToolpackAvailability } from '../toolpacks/toolpack-registry.js';
import { buildRunReplay } from '../runs/replay.js';
import { buildRunSynthesis, buildStubSynthesis, enrichSynthesisWithLLM } from '../runs/synthesis.js';
import { llmCompleteJson } from '../ai/llm-client.js';
import { getPostureTrend } from '../runs/trending.js';
import { getOnboardingStatus, markOnboardingComplete, resetOnboarding } from '../onboarding/onboarding.js';
import {
  createAsset, getAsset, getAssets, updateAsset, archiveAsset,
  createFinding, getFindings, updateFinding,
  createAssetSnapshot, getAssetSnapshots,
  createRunTemplateFromRun, getRunTemplates, materializeRunFromTemplate,
  compareAssetSnapshots, getRunComparisons,
} from '../assets/asset-store.js';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, statSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';

const execAsync = promisify(exec);
import { join, basename } from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';

const router = Router();

// Multer for file uploads (skills .zip)
const upload = multer({ dest: '/tmp/phantom-uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Sec-ops installer ───────────────────────────────────────────────────
// Detects the host's package manager(s), maps catalog tools to install
// commands, and serves an approval-gated install workflow. The exec path
// runs each step via Node's spawn (no shell), captures stdout/stderr/exit,
// and persists the result for replay.

router.get('/installer/status', (req, res) => {
  res.json(getInstallerStatus());
});

router.get('/installer/catalog', (req, res) => {
  res.json({ tiers: TIERS, ...getInstallerStatus() });
});

// Preview without persistence — used by Settings when the operator picks
// a tier so they see the exact command list before requesting approval.
router.post('/installer/preview', (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.toolIds)
    ? body.toolIds
    : (body.tier && TIERS.includes(body.tier) ? toolIdsForTier(body.tier) : []);
  if (!ids.length) return res.status(400).json({ error: 'toolIds or tier is required' });
  const plan = resolveInstallPlan(ids);
  res.json({ plan, summary: summarizePlan(plan) });
});

router.post('/installer/request', (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.toolIds)
    ? body.toolIds
    : (body.tier && TIERS.includes(body.tier) ? toolIdsForTier(body.tier) : []);
  if (!ids.length) return res.status(400).json({ error: 'toolIds or tier is required' });
  const plan = resolveInstallPlan(ids);
  const request = createInstallRequest({ toolIds: ids, plan, note: body.note || '' });
  res.json({ request, summary: summarizePlan(plan) });
});

router.get('/installer/requests', (req, res) => {
  res.json(getInstallRequests({ status: req.query.status || null, limit: req.query.limit || 50 }));
});

router.get('/installer/requests/:id', (req, res) => {
  const request = getInstallRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Install request not found' });
  res.json(request);
});

router.post('/installer/requests/:id/cancel', (req, res) => {
  const request = getInstallRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Install request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: `cannot cancel a ${request.status} request` });
  const updated = updateInstallRequest(req.params.id, {
    status: 'cancelled',
    decidedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  res.json(updated);
});

// Execute the install plan. Each step runs sequentially via spawn (no
// shell), bounded by a per-step timeout. The captured per-step result
// (exit, stdout-tail, stderr-tail) lands in the request's result_json
// so the Approvals page can replay what happened.
router.post('/installer/requests/:id/approve', async (req, res) => {
  const request = getInstallRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Install request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: `cannot approve a ${request.status} request` });

  updateInstallRequest(req.params.id, { status: 'running', decidedAt: new Date().toISOString() });

  const steps = [];
  const PER_STEP_TIMEOUT_MS = 10 * 60_000; // 10 min cap per step (heavy packages can be slow)
  let failed = false;

  for (const entry of request.plan) {
    if (!entry.backend || !entry.command) {
      steps.push({
        id: entry.id, backend: null, command: null, args: null,
        skipped: true, reason: entry.reason || 'no package available',
      });
      continue;
    }
    const step = await runStep(entry, PER_STEP_TIMEOUT_MS);
    steps.push(step);
    if (step.exit !== 0) {
      failed = true;
      // Continue on per-step failure rather than abort — operator may
      // still want the other packages installed and can re-request the
      // failed ones with more privileges later.
    }
  }

  const finalStatus = failed ? 'failed' : 'completed';
  const updated = updateInstallRequest(req.params.id, {
    status: finalStatus,
    result: { steps },
    completedAt: new Date().toISOString(),
  });
  res.json(updated);
});

// Privilege-failure signature matchers. The exit code alone isn't enough
// (sudo returns 1, winget returns 5 or 0x80073D06, brew returns 1 with
// "must be administrator") so we match on captured stderr/stdout too.
// `kind: 'admin'` means "the package manager refused for lack of
// privilege" — the UI surfaces a clear next step rather than the raw
// exit code. Patterns are conservative: false negatives (missed admin
// failures shown as generic exit) are recoverable; false positives
// would tell the operator "needs admin" for unrelated failures, so we
// require explicit phrasing.
const ADMIN_FAILURE_PATTERNS = [
  /must (?:be|run as) root/i,
  /are you root/i,
  /permission denied/i,
  /requires (?:administrator|elevation|root|sudo)/i,
  /access is denied/i,
  /sudo: a password is required/i,
  /operation not permitted/i,
  /eaccess/i,
  /not enough permissions/i,
];
// winget elevation errors are encoded numerically.
const WINGET_ADMIN_EXIT_CODES = new Set([
  -1978335230, // 0x8A150022 — APPINSTALLER_CLI_ERROR_NEEDS_REMEDIATION
  -1978334202, // 0x8A150426 — needs elevation
  -2147023293, // 0x80073D06 — DELIVERY_OPTIMIZATION needs elevation
]);

function classifyResult(step) {
  if (step.skipped) return { kind: 'skipped' };
  if (step.timedOut) return { kind: 'timeout' };
  if (step.exit === 0) return { kind: 'ok' };
  const blob = `${step.stderrTail || ''} ${step.stdoutTail || ''}`;
  const matched = ADMIN_FAILURE_PATTERNS.some(re => re.test(blob));
  if (matched) return { kind: 'admin' };
  if (step.backend === 'winget' && WINGET_ADMIN_EXIT_CODES.has(step.exit)) return { kind: 'admin' };
  if (step.backend === 'choco' && step.exit === 1603) return { kind: 'admin' }; // MSI install needs admin
  return { kind: 'failed' };
}

// Compose a single-line elevated command string the operator can paste
// into their own admin shell. Used by the UI's "Copy elevated command"
// affordance for Windows / cases where the host lacks a cached sudo
// password. Pure quoting — we never execute this; the operator does.
function elevatedCommandPreview(entry, os) {
  const shellQuote = (s) => /[\s"']/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s);
  const parts = [entry.command, ...(entry.args || [])].map(shellQuote);
  if (os === 'win32') {
    // PowerShell elevated one-liner — no Start-Process flag needed if the
    // operator already pasted into an admin shell, but Start-Process makes
    // the intent obvious.
    return `Start-Process -Verb RunAs ${parts[0]} -ArgumentList ${parts.slice(1).join(',')}`;
  }
  // POSIX — operator runs in their own TTY where sudo can prompt.
  if (entry.command === 'sudo') return parts.slice(0).join(' '); // already sudo'd
  return `sudo ${parts.join(' ')}`;
}

function runStep(entry, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;

    // Linux sudo password injection. The installer's apt/dnf/pacman steps
    // resolve to `sudo apt-get install …`; without a TTY (we're inside an
    // Express request) sudo fails to prompt. If the operator has cached
    // their sudo password via /api/sudo/validate, prepend `-S` and pipe
    // the password to stdin so the install proceeds non-interactively.
    let cmd = entry.command;
    let args = entry.args || [];
    let stdinFeed = null;
    if (process.platform === 'linux' && cmd === 'sudo' && !args.includes('-S')) {
      const cachedPass = getSetting('sudo_password', '');
      if (cachedPass) {
        args = ['-S', ...args];
        stdinFeed = cachedPass + '\n';
      }
    }

    try {
      child = spawn(cmd, args, { shell: false });
    } catch (err) {
      resolve({
        id: entry.id, backend: entry.backend, command: entry.command, args: entry.args,
        exit: -1, error: err.message, startedAt, endedAt: new Date().toISOString(),
        stdoutTail: '', stderrTail: err.message,
        classification: { kind: 'failed' },
      });
      return;
    }
    if (stdinFeed && child.stdin && !child.stdin.destroyed) {
      try { child.stdin.write(stdinFeed); child.stdin.end(); } catch { /* ignore */ }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* may already be gone */ }
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > 20_000) stdout = stdout.slice(-20_000); });
    child.stderr?.on('data', (chunk) => {
      // Strip sudo's interactive password prompt from stderr so it never
      // appears in the UI even if -S is in use.
      const text = chunk.toString().replace(/\[sudo\] password for.*?:\s*/g, '');
      stderr += text;
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.on('close', (exit) => {
      clearTimeout(timer);
      const result = {
        id: entry.id, backend: entry.backend, command: entry.command, args: entry.args,
        exit: timedOut ? 124 : (exit ?? -1),
        timedOut,
        startedAt, endedAt: new Date().toISOString(),
        stdoutTail: stdout.slice(-4_000),
        stderrTail: stderr.slice(-4_000),
      };
      result.classification = classifyResult(result);
      if (result.classification.kind === 'admin') {
        result.elevatedCommand = elevatedCommandPreview(entry, process.platform);
      }
      resolve(result);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      const result = {
        id: entry.id, backend: entry.backend, command: entry.command, args: entry.args,
        exit: -1, error: err.message,
        startedAt, endedAt: new Date().toISOString(),
        stdoutTail: stdout.slice(-4_000),
        stderrTail: (stderr + '\n' + err.message).slice(-4_000),
      };
      result.classification = classifyResult(result);
      if (result.classification.kind === 'admin') {
        result.elevatedCommand = elevatedCommandPreview(entry, process.platform);
      }
      resolve(result);
    });
  });
}

// Test surface so the classification logic can be unit-tested without
// spawning subprocesses. Not exported in the route's public API.
export const _installerInternals = { classifyResult, elevatedCommandPreview };

// ─── Posture trending ────────────────────────────────────────────────────
// Aggregates synthesis-card scores across recent runs so the Dash can show
// a posture trend without re-deriving the metric. Filterable by scopeId.
router.get('/trending/posture', (req, res) => {
  res.json(getPostureTrend({
    scopeId: req.query.scopeId || null,
    limit:   req.query.limit   || 12,
    includeRecentRuns: req.query.includeRecentRuns !== 'false',
  }));
});

// ─── Onboarding ──────────────────────────────────────────────────────────
// Surfaces first-run state to the frontend so the wizard can decide whether
// to auto-open. Completion is a sticky flag in the settings table — once
// the operator dismisses the wizard we never auto-open it again, even if
// they later wipe their data. Settings → "Re-run onboarding" calls
// /reset to clear the flag.
router.get('/onboarding/status', (req, res) => {
  res.json(getOnboardingStatus());
});
router.post('/onboarding/complete', (req, res) => {
  res.json(markOnboardingComplete(true));
});
router.post('/onboarding/reset', (req, res) => {
  res.json(resetOnboarding());
});

// ─── Providers ───
// Returns the registry of OpenAI-compatible providers PHANTOM can route to.
// Used by the Settings UI to populate the provider dropdown. No secrets are
// returned — only public metadata (baseUrl is a default suggestion, not a key).
router.get('/providers', (req, res) => {
  res.json({
    default: DEFAULT_PROVIDER_ID,
    providers: listProvidersPublic(),
  });
});

// ─── Settings ───
router.get('/settings', (req, res) => {
  const settings = getAllSettings();
  const providerId = settings.api_provider || config.api.provider || DEFAULT_PROVIDER_ID;
  res.json({
    provider: providerId,
    baseUrl: settings.api_base_url || config.api.baseUrl,
    apiKey: settings.api_key ? '••••••••' + settings.api_key.slice(-4) : '',
    apiKeySet: !!settings.api_key || !!config.api.apiKey,
    model: settings.api_model || config.api.model,
    temperature: parseFloat(settings.api_temperature || config.api.temperature),
    maxTokens: parseInt(settings.api_max_tokens || config.api.maxTokens),
    workspace: settings.workspace || config.workspace,
    sudoConfigured: !!settings.sudo_password,
    synthesisLlmEnabled: settings.synthesis_llm_enabled === '1',
  });
});

router.put('/settings', (req, res) => {
  const { provider, baseUrl, apiKey, model, temperature, maxTokens, sudoPassword, workspace, synthesisLlmEnabled } = req.body;
  // Feature flag: LLM-enriched synthesis highlights/nextSteps. Persisted
  // as '0' / '1' in the settings table; read by /api/runs/:id/synthesis.
  if (synthesisLlmEnabled !== undefined) {
    setSetting('synthesis_llm_enabled', synthesisLlmEnabled ? '1' : '0');
  }

  // Provider must be handled before baseUrl so explicit baseUrl wins, but
  // the auto-derived URL from the provider registry takes effect when the
  // client only sends a provider change.
  if (provider) {
    const known = getProvider(provider);
    setSetting('api_provider', known.id);
    // If the caller didn't override baseUrl, persist the registry's URL too
    // so subsequent GETs reflect the routed endpoint.
    if (!baseUrl && known.baseUrl) setSetting('api_base_url', known.baseUrl);
    updateConfig({ provider: known.id, ...(baseUrl ? {} : {}) });
  }
  if (baseUrl) { setSetting('api_base_url', baseUrl); updateConfig({ baseUrl }); }
  if (apiKey && apiKey !== '••••••••') { setSetting('api_key', apiKey); updateConfig({ apiKey }); }
  if (model) { setSetting('api_model', model); updateConfig({ model }); }
  if (temperature !== undefined) { setSetting('api_temperature', String(temperature)); updateConfig({ temperature }); }
  if (maxTokens !== undefined) { setSetting('api_max_tokens', String(maxTokens)); updateConfig({ maxTokens }); }
  if (sudoPassword !== undefined) { setSetting('sudo_password', sudoPassword); }
  if (workspace) { setSetting('workspace', workspace); updateConfig({ workspace }); }

  resetClient();
  res.json({ success: true, message: 'Settings updated' });
});

router.post('/settings/test', async (req, res) => {
  const result = await testConnection();
  res.json(result);
});

// ─── Dynamic model discovery ───
// Fetches the configured provider's OpenAI-compatible /v1/models endpoint.
// Used by Settings to populate the model dropdown from a live list rather
// than the static `suggestedModels` baked into the registry.
//
// Falls back to the registry's suggestedModels if the endpoint is
// unreachable, the key is missing, or the response shape doesn't match
// the OpenAI spec. Failure is *expected* for local-only endpoints
// (Ollama / LM Studio when the daemon isn't running) and for endpoints
// that don't implement /v1/models (some self-hosted shims).
router.get('/models', async (req, res) => {
  const baseUrl = (config.api.baseUrl || '').replace(/\/+$/, '');
  const apiKey = config.api.apiKey || '';
  if (!baseUrl) {
    return res.json({ ok: false, error: 'No base URL configured', models: [] });
  }

  // Resolve fallback suggestions from the registry for the active provider.
  const providerId = config.api.provider;
  const provider = providerId ? getProvider(providerId) : null;
  const fallback = (provider?.suggestedModels || []).map((id) => ({ id, source: 'suggested' }));

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const r = await fetch(`${baseUrl}/models`, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) {
      return res.json({
        ok: false,
        error: `HTTP ${r.status}`,
        models: fallback,
        source: 'fallback',
      });
    }
    const data = await r.json();
    // OpenAI spec: { object: 'list', data: [{ id, object: 'model', ... }] }
    // Some shims return a bare array instead of {data: [...]}.
    const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const models = list
      .map((m) => (typeof m === 'string' ? { id: m } : { id: m?.id, owned_by: m?.owned_by, created: m?.created }))
      .filter((m) => m.id);
    if (!models.length) {
      return res.json({ ok: false, error: 'No models in response', models: fallback, source: 'fallback' });
    }
    res.json({ ok: true, models, source: 'live', baseUrl, provider: providerId });
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'unreachable');
    res.json({ ok: false, error: reason, models: fallback, source: 'fallback' });
  }
});

// ─── Prompt Preview + Profiles ───
router.get('/prompts/preview', (req, res) => {
  const basePrompt = buildSystemPrompt({ raw: true });
  const toolpackIds = req.query.toolpackIds ? String(req.query.toolpackIds).split(',') : [];
  const resolved = resolvePrompt({ basePrompt, profileId: req.query.profileId || null, scopeId: req.query.scopeId || null, toolpackIds });
  res.json({
    id: resolved.profile?.id || 'system-default',
    mode: resolved.profile?.mode || 'default',
    profile: resolved.profile,
    scope: resolved.scope ? { id: resolved.scope.id, name: resolved.scope.name, expires_at: resolved.scope.expires_at } : null,
    toolpacks: resolved.toolpacks.map(pack => ({ id: pack.id, name: pack.name, summary: pack.summary, risks: pack.risks, defaultLevel: pack.defaultLevel || null, levels: pack.levels || null })),
    fragmentIds: resolved.snapshot.fragmentIds,
    content: resolved.content,
    length: resolved.content.length,
  });
});

router.get('/prompts/profiles', (req, res) => res.json(getPromptProfiles()));
router.post('/prompts/profiles', (req, res) => {
  try { res.json(createPromptProfile(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/prompts/profiles/:id', (req, res) => {
  const profile = updatePromptProfile(req.params.id, req.body || {});
  if (!profile) return res.status(404).json({ error: 'Prompt profile not found' });
  res.json(profile);
});

router.get('/prompts/fragments', (req, res) => {
  res.json(getPromptFragments({
    profileId: req.query.profileId === undefined ? undefined : (req.query.profileId || null),
    enabled: req.query.enabled === undefined ? undefined : req.query.enabled !== 'false',
  }));
});
router.post('/prompts/fragments', (req, res) => {
  try { res.json(createPromptFragment(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/prompts/fragments/:id', (req, res) => {
  const fragment = updatePromptFragment(req.params.id, req.body || {});
  if (!fragment) return res.status(404).json({ error: 'Prompt fragment not found' });
  res.json(fragment);
});

// ─── Scopes ───
router.get('/scopes', (req, res) => {
  res.json(getScopes({ includeArchived: req.query.includeArchived === 'true' }));
});
router.get('/scopes/templates', (req, res) => {
  res.json(getScopeTemplates());
});
// ROE (rules-of-engagement) templates — pre-built scope payloads that fill
// action_modes, time windows, rate caps, and ROE notes for common
// engagement types (internal pentest, bug bounty, red team, etc.).
router.get('/scopes/roe-templates', (req, res) => {
  res.json({ action_classes: ACTION_CLASSES, templates: getRoeTemplates() });
});
router.get('/scopes/roe-templates/:id', (req, res) => {
  const tpl = getRoeTemplate(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'ROE template not found' });
  res.json(tpl);
});
router.post('/scopes/parse-targets', (req, res) => {
  const parsed = parseTargetInput(req.body?.input || '');
  res.json({ ...parsed, scopeFields: targetsToScopeFields(parsed.targets) });
});
router.post('/scopes/evaluate-draft', (req, res) => {
  const scope = {
    id: 'draft',
    name: req.body?.scope?.name || 'Draft scope',
    targets: req.body?.scope?.targets || {},
    allowed_actions: req.body?.scope?.allowedActions || req.body?.scope?.allowed_actions || [],
    blocked_actions: req.body?.scope?.blockedActions || req.body?.scope?.blocked_actions || [],
    expires_at: req.body?.scope?.expiresAt || req.body?.scope?.expires_at || null,
  };
  res.json(evaluateToolAction({
    toolName: req.body?.toolName || 'execute_command',
    args: req.body?.args || {},
    scope,
    operatorOverride: normalizeOperatorOverride(req.body?.operatorOverride),
  }));
});
router.post('/scopes', (req, res) => {
  try { res.json(createScope(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get('/scopes/:id', (req, res) => {
  const scope = getScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  res.json(scope);
});
router.put('/scopes/:id', (req, res) => {
  try {
    const scope = updateScope(req.params.id, req.body || {});
    if (!scope) return res.status(404).json({ error: 'Scope not found' });
    res.json(scope);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.post('/scopes/:id/archive', (req, res) => {
  const scope = archiveScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  res.json(scope);
});
router.delete('/scopes/:id', (req, res) => {
  const scope = archiveScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  res.json(scope);
});
// PATCH a single action class's mode — used by the chat-side "promote to
// auto" suggestion after the operator has approved the same action 3+ times.
// Round-trips through scope-store.updateScope so the change is persisted
// and emits an updated_at bump.
router.patch('/scopes/:id/action-mode', (req, res) => {
  const scope = getScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  const cls = String(req.body?.actionClass || '').toLowerCase();
  const mode = String(req.body?.mode || '').toLowerCase();
  if (!cls) return res.status(400).json({ error: 'actionClass required' });
  if (!['auto', 'ask', 'deny'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be auto | ask | deny' });
  }
  const next = { ...(scope.action_modes || {}), [cls]: mode };
  try {
    const updated = updateScope(req.params.id, { actionModes: next });
    res.json(updated);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/scopes/:id/evaluate', (req, res) => {
  const scope = getScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  res.json(evaluateToolAction({
    toolName: req.body?.toolName,
    args: req.body?.args || {},
    scope,
    operatorOverride: normalizeOperatorOverride(req.body?.operatorOverride),
  }));
});

// ─── Assets, Findings, Baselines, Reruns ───
function assetDetail(asset) {
  if (!asset) return null;
  return {
    ...asset,
    findings: getFindings({ assetId: asset.id, limit: 200 }),
    snapshots: getAssetSnapshots({ assetId: asset.id, limit: 100 }),
  };
}

router.get('/assets', (req, res) => {
  res.json(getAssets({
    includeArchived: req.query.includeArchived === 'true',
    query: req.query.query || '',
    type: req.query.type || null,
    tag: req.query.tag || null,
    limit: req.query.limit || 100,
  }));
});

router.post('/assets', (req, res) => {
  try { res.json(createAsset(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/assets/:id', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(assetDetail(asset));
});

router.put('/assets/:id', (req, res) => {
  try {
    const asset = updateAsset(req.params.id, req.body || {});
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/assets/:id/archive', (req, res) => {
  const asset = archiveAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});
router.delete('/assets/:id', (req, res) => {
  const asset = archiveAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});

router.get('/assets/:id/snapshots', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(getAssetSnapshots({ assetId: req.params.id, limit: req.query.limit || 100 }));
});
router.post('/assets/:id/snapshots', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  try { res.json(createAssetSnapshot({ ...(req.body || {}), assetId: req.params.id })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/findings', (req, res) => {
  res.json(getFindings({ assetId: req.query.assetId || null, runId: req.query.runId || null, status: req.query.status || null, severity: req.query.severity || null, limit: req.query.limit || 100 }));
});
router.post('/findings', (req, res) => {
  try { res.json(createFinding(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/findings/:id', (req, res) => {
  try {
    const finding = updateFinding(req.params.id, req.body || {});
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    res.json(finding);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/run-templates', (req, res) => {
  res.json(getRunTemplates({ sourceRunId: req.query.sourceRunId || null, limit: req.query.limit || 100 }));
});
router.post('/run-templates', (req, res) => {
  try { res.json(createRunTemplateFromRun(req.body?.sourceRunId, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post('/run-templates/:id/runs', (req, res) => {
  try { res.json(materializeRunFromTemplate(req.params.id, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/comparisons', (req, res) => res.json(getRunComparisons({ limit: req.query.limit || 100 })));
router.post('/comparisons', (req, res) => {
  try { res.json(compareAssetSnapshots(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── Approval audit ──────────────────────────────────────────────────────
// All approval/denial/override events are reconstructed from trace_events
// — no new table needed. Filterable by decision, risk, scopeId, toolName,
// and an ISO `since` timestamp.
router.get('/approvals', (req, res) => {
  const events = getApprovalEvents({
    limit: req.query.limit || 100,
    decision: req.query.decision || null,
    risk: req.query.risk || null,
    scopeId: req.query.scopeId || null,
    toolName: req.query.toolName || null,
    since: req.query.since || null,
  });
  res.json({ count: events.length, events });
});
router.get('/approvals/stats', (req, res) => {
  res.json(getApprovalStats({ since: req.query.since || null }));
});

// ─── Runs + Trace Events ───
router.get('/runs', (req, res) => {
  res.json(getRuns({
    limit: req.query.limit || 50,
    conversationId: req.query.conversationId || null,
    includeCompleted: req.query.includeCompleted !== 'false',
  }));
});

router.get('/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const artifacts = getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact));
  res.json({ ...run, events: getTraceEvents(req.params.id), artifacts });
});

router.get('/runs/:id/replay', (req, res) => {
  const replay = buildRunReplay(req.params.id, { eventLimit: req.query.limit || 2000 });
  if (!replay) return res.status(404).json({ error: 'Run not found' });
  res.json(replay);
});

// End-of-run synthesis card. Single canonical data shape — also consumed by
// the onboarding wizard preview and the posture-trending dashboard.
//
// Pass ?preview=stub for a hand-tuned sample synthesis without touching the DB
// (used by the onboarding wizard to show "here's what you'll see when a run
// finishes" before any real runs exist).
router.get('/runs/:id/synthesis', async (req, res) => {
  if (req.query.preview === 'stub') {
    return res.json(buildStubSynthesis());
  }
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact));
  const findings = getFindings({ runId: req.params.id, limit: 500 });
  const replay = buildRunReplay(req.params.id, { eventLimit: 2000 })?.replay || null;
  const previousScore = req.query.previousScore ? Number(req.query.previousScore) : null;

  let synthesis = buildRunSynthesis({
    run, events, artifacts, findings, replay,
    previousScore: Number.isFinite(previousScore) ? previousScore : null,
  });

  // Feature-flagged LLM enrichment: replaces the heuristic highlights[] +
  // nextSteps[] with content the model generates from the actual trace.
  // Flag default is OFF. Operator toggles `synthesis_llm_enabled` in
  // settings (or via the query string `?enrich=1` for ad-hoc testing).
  // Any failure falls back to the heuristic synthesis — the endpoint
  // remains green even if the model is down.
  const flagOn = getSetting('synthesis_llm_enabled', '0') === '1';
  const explicit = req.query.enrich === '1';
  if ((flagOn || explicit) && run.status !== 'running') {
    synthesis = await enrichSynthesisWithLLM(synthesis, events, { llmCompleteJson });
  }
  res.json(synthesis);
});

router.get('/runs/:id/artifacts', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact)));
});

router.get('/runs/:id/graph', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: req.query.limit || 2000 });
  const artifacts = getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact, { includeMetadata: true }));
  res.json(deriveRunGraph({ run, events, artifacts }));
});

router.post('/runs/:id/artifacts/graph', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact, { includeMetadata: true }));
  const graph = deriveRunGraph({ run, events, artifacts });
  const artifact = writeArtifact({
    runId: run.id,
    conversationId: run.conversation_id,
    type: 'json',
    title: 'Graph snapshot',
    mimeType: 'application/json',
    extension: '.json',
    content: JSON.stringify(graph, null, 2),
    metadata: { source: 'graph_snapshot', eventCount: events.length, nodeCount: graph.nodes.length, edgeCount: graph.edges.length },
  });
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.post('/runs/:id/artifacts/report', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id);
  const artifact = writeArtifact({
    runId: run.id,
    conversationId: run.conversation_id,
    type: 'markdown',
    title: 'Pentest report',
    mimeType: 'text/markdown',
    extension: '.md',
    content: renderPentestReport(run, events, artifacts),
    metadata: { source: 'pentest_report', eventCount: events.length, artifactCount: artifacts.length },
  });
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.post('/runs/:id/artifacts/summary', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id);
  const artifact = writeArtifact({
    runId: run.id,
    conversationId: run.conversation_id,
    type: 'markdown',
    title: 'Executive summary',
    mimeType: 'text/markdown',
    extension: '.md',
    content: renderExecutiveSummary(run, events, artifacts),
    metadata: { source: 'executive_summary', eventCount: events.length, artifactCount: artifacts.length },
  });
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.post('/runs/:id/artifacts/evidence', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id);
  const artifact = exportEvidenceBundle(run, events, artifacts);
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.get('/runs/:id/events', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(getTraceEvents(req.params.id, { limit: req.query.limit || 500 }));
});

// ─── Artifacts ───
router.get('/artifacts', (req, res) => {
  const artifacts = getArtifacts({
    limit: req.query.limit || 100,
    runId: req.query.runId || null,
    conversationId: req.query.conversationId || null,
    type: req.query.type || null,
  });
  res.json(artifacts.map(artifact => artifactToPublic(artifact)));
});

router.get('/artifacts/:id', (req, res) => {
  const artifact = getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.get('/artifacts/:id/content', (req, res) => {
  const artifact = getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
  if (!existsSync(artifact.path)) return res.status(404).json({ error: 'Artifact content not found' });
  res.type(artifact.mime_type);
  res.sendFile(artifact.path);
});

router.get('/artifacts/:id/download', (req, res) => {
  const artifact = getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
  if (!existsSync(artifact.path)) return res.status(404).json({ error: 'Artifact content not found' });
  res.download(artifact.path, basename(artifact.path));
});

// ─── Conversations ───
router.get('/conversations', (req, res) => {
  res.json(getConversations());
});

router.post('/conversations', (req, res) => {
  const conv = createConversation(req.body.title || 'New Conversation');
  res.json(conv);
});

router.get('/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const messages = getMessages(req.params.id);
  res.json({ ...conv, messages });
});

router.delete('/conversations/:id', (req, res) => {
  deleteConversation(req.params.id);
  res.json({ success: true });
});

router.put('/conversations/:id/title', (req, res) => {
  updateConversationTitle(req.params.id, req.body.title);
  res.json({ success: true });
});

// ─── Tools ───
router.get('/tools', (req, res) => {
  res.json(getToolDefinitions().map(t => ({
    name: t.function.name,
    description: t.function.description,
  })));
});

router.get('/toolpacks', (req, res) => {
  res.json(getToolpacks());
});
router.get('/toolpacks/:id', (req, res) => {
  const pack = getToolpack(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Toolpack not found' });
  res.json(pack);
});
router.get('/toolpacks/:id/availability', (req, res) => {
  const pack = checkToolpackAvailability(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Toolpack not found' });
  res.json(pack);
});

// ─── Memory ───
router.get('/memory', (req, res) => {
  const { query, category } = req.query;
  if (query) {
    res.json(searchMemories(query, category));
  } else {
    res.json(getAllMemories(category));
  }
});

// ─── MCP Servers ───
router.get('/mcp/servers', (req, res) => {
  res.json(getMCPServers());
});

router.post('/mcp/servers', (req, res) => {
  const id = addMCPServer(req.body);
  res.json({ success: true, id });
});

router.delete('/mcp/servers/:id', (req, res) => {
  removeMCPServer(req.params.id);
  res.json({ success: true });
});

// ─── Sudo Validation ───
router.post('/sudo/validate', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.json({ valid: false, message: 'No password provided' });
  }

  try {
    // Test sudo password by running a harmless command without blocking event loop
    const escapedPass = password.replace(/'/g, "'\\''");
    try {
      await execAsync(`echo '${escapedPass}' | sudo -S -p '' echo 'phantom_sudo_ok' 2>&1`, {
        encoding: 'utf8',
        timeout: 15000,
      });
      // Password is correct — store it
      setSetting('sudo_password', password);
      res.json({ valid: true, message: 'Sudo access granted ✅' });
    } catch (err) {
      res.json({ valid: false, message: 'Incorrect sudo password' });
    }
  } catch (err) {
    res.json({ valid: false, message: `Validation error: ${err.message}` });
  }
});

// ─── System Info ───
router.get('/system/info', async (req, res) => {
  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    user: os.userInfo().username,
    uptime: os.uptime(),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
    },
    cpus: os.cpus().length,
  };

  // Run external commands concurrently without blocking the event loop
  const results = await Promise.allSettled([
    execAsync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'', { encoding: 'utf8' }),
    execAsync("hostname -I 2>/dev/null | awk '{print $1}'", { encoding: 'utf8' })
  ]);

  if (results[0].status === 'fulfilled' && results[0].value.stdout) {
    info.distro = results[0].value.stdout.trim();
  }
  if (results[1].status === 'fulfilled' && results[1].value.stdout) {
    info.ip = results[1].value.stdout.trim();
  }

  // Check if sudo password is stored
  info.sudoConfigured = !!getSetting('sudo_password', '');
  info.workspace = config.workspace;

  res.json(info);
});

// ─── Skills Management ───
function getSkillsDir() {
  const dir = join(config.workspace, 'skills');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

router.get('/skills', (req, res) => {
  try {
    const skillsDir = getSkillsDir();
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skills = entries.filter(e => e.isDirectory()).map(e => {
      const skillPath = join(skillsDir, e.name);
      let meta = { name: e.name, description: '', files: [] };
      // Try reading a manifest/readme
      try {
        const metaPath = join(skillPath, 'skill.json');
        if (existsSync(metaPath)) {
          meta = { ...meta, ...JSON.parse(readFileSync(metaPath, 'utf8')) };
        }
      } catch {}
      try {
        meta.files = readdirSync(skillPath).slice(0, 20);
      } catch {}
      return meta;
    });
    res.json(skills);
  } catch (err) {
    res.json([]);
  }
});

router.post('/skills/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const skillsDir = getSkillsDir();
    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries();
    // Determine skill name from zip
    const firstDir = entries.find(e => e.isDirectory);
    let skillName = firstDir ? firstDir.entryName.split('/')[0] : req.file.originalname.replace(/\.zip$/i, '');

    // Sanitize skillName to prevent path traversal
    skillName = basename(skillName);
    if (!skillName || skillName === '.' || skillName === '..') {
      return res.status(400).json({ error: 'Invalid skill name' });
    }

    const extractTo = join(skillsDir, skillName);
    if (!existsSync(extractTo)) mkdirSync(extractTo, { recursive: true });
    zip.extractAllTo(extractTo, true);
    // Cleanup temp file
    try { rmSync(req.file.path); } catch {}
    res.json({ success: true, name: skillName, message: `Skill "${skillName}" imported successfully` });
  } catch (err) {
    res.status(500).json({ error: `Failed to import skill: ${err.message}` });
  }
});

router.delete('/skills/:name', (req, res) => {
  try {
    const skillsDir = getSkillsDir();
    const skillName = basename(req.params.name);
    if (!skillName || skillName === '.' || skillName === '..') {
      return res.status(400).json({ error: 'Invalid skill name' });
    }
    const skillPath = join(skillsDir, skillName);
    if (existsSync(skillPath)) {
      rmSync(skillPath, { recursive: true, force: true });
      res.json({ success: true, message: `Skill "${skillName}" deleted` });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── AI Doctor ───
// Uses temporary API credentials — completely separate from main PHANTOM config.
// Uses raw fetch to call any OpenAI-compatible API and pipes the SSE stream to the client.
router.post('/doctor/chat', async (req, res) => {
  const { message, config: doctorCfg, systemPrompt } = req.body;

  if (!doctorCfg?.apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  const baseUrl = (doctorCfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey  = doctorCfg.apiKey;
  const model   = doctorCfg.model || 'gpt-4o';

  // Gather live system context without blocking the event loop
  const sysInfo = [];
  const sysCommands = [
    { prefix: 'OS: ', cmd: "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'" },
    { prefix: 'Kernel: ', cmd: 'uname -r' },
    { prefix: 'Uptime: ', cmd: 'uptime -p' },
    { prefix: 'Disk: ', cmd: 'df -h / | tail -1' },
    { prefix: 'Memory: ', cmd: 'free -h | head -2 | tail -1' },
    { prefix: 'Failed services:\n', cmd: 'systemctl --failed --no-legend 2>/dev/null | head -10' }
  ];

  const sysResults = await Promise.allSettled(
    sysCommands.map(c => execAsync(c.cmd, { encoding: 'utf8' }))
  );

  sysResults.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value.stdout) {
      const output = result.value.stdout.trim();
      if (output) {
        sysInfo.push(sysCommands[idx].prefix + output);
      }
    }
  });

  const fullSystemPrompt =
    (systemPrompt || 'You are Dr. AI — an expert Linux system administrator and diagnostics AI. Diagnose and fix system issues proactively.') +
    (sysInfo.length ? `\n\n## LIVE SYSTEM STATE\n${sysInfo.join('\n')}` : '');

  const messages = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user',   content: message },
  ];

  // Send SSE headers immediately
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // Call OpenAI-compatible API directly via fetch — no SDK, no dynamic import issues
    const apiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      const errContent = `\n\n❌ **API Error ${apiRes.status}**\n\`\`\`\n${errText.substring(0, 400)}\n\`\`\``;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errContent } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Pipe SSE bytes directly from OpenAI API → client (format is already correct)
    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done || req.socket.destroyed) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[AI Doctor] Error:', err.message);
    const errContent = `\n\n❌ **Error:** ${err.message}`;
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errContent } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

export default router;
