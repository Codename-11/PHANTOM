import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { networkInterfaces } from 'os';

import config, { loadPersistedSettings } from './config.js';
import {
  initDB, closeDB, createConversation, getMessages, updateConversationTitle, getSetting,
  createRun, addTraceEvent, completeRun, failRun, updateRunStatus,
} from './memory/store.js';
import { processMessage } from './ai/llm-client.js';
import { buildSystemPrompt } from './ai/system-prompt.js';
import { getScope } from './scope/scope-store.js';
import { resolvePrompt } from './prompts/prompt-store.js';
import { normalizeOperatorOverride } from './scope/policy.js';
import { getToolpacks } from './toolpacks/toolpack-registry.js';
import { writePreviewArtifact, exportRunTrace } from './artifacts/artifact-store.js';
import { artifactToPublic } from './artifacts/renderers.js';
import { getCurrentGoalId, tagRunWithGoal } from './goals/goal-store.js';
import { recordRunOutcomeAgainstGoal } from './goals/goal-progress.js';
import { finalizeRunForCampaign } from './campaigns/goal-engine.js';
import apiRouter from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── React migration gate (Phase A8.0) ──────────────────────────────────
// Each entry is a route prefix that should be served by the React bundle
// in dist/react/index.html INSTEAD of the legacy vanilla bundle.
// Empty default = the React bundle is built but never served, so behavior
// is identical to pre-A8.0. Phase A8.1+ adds entries one route at a time.
const REACT_PAGES = new Set([]);
const reactDistPath = join(ROOT, 'dist', 'react');
const reactIndexPath = join(reactDistPath, 'index.html');
const reactBundleAvailable = existsSync(reactIndexPath);

// Initialize database
initDB();

// Load persisted settings from DB (API keys, workspace, etc.)
loadPersistedSettings(getSetting);

// Create Express app
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API routes
app.use('/api', apiRouter);

// ─── Built-in user-docs (/docs) ────────────────────────────────────────
// Serves the VitePress build from user-docs/.vitepress/dist when the
// `docs_enabled` setting is on (default '1') AND the dist exists. The
// dist is produced by `npm run build:docs`. If the build is missing we
// log a friendly hint at boot rather than 404-ing without context.
//
// The route is decided at boot — toggling the setting requires a restart.
// That's a deliberate tradeoff: changing whether docs are served means
// re-mounting middleware, which Express doesn't support gracefully in
// the middle of a request lifecycle. Restart cost is one second.
const docsDist = join(ROOT, 'user-docs', '.vitepress', 'dist');
const docsEnabled = getSetting('docs_enabled', '1') === '1';
const docsBuilt = existsSync(join(docsDist, 'index.html'));
if (docsEnabled && docsBuilt) {
  // Trailing-slash redirect so /docs lands at /docs/ (VitePress assets
  // resolve from the base path). Using a regex route with explicit
  // anchors because Express's default non-strict routing would otherwise
  // match the trailing-slash form too — creating a redirect loop.
  app.get(/^\/docs$/, (req, res) => res.redirect(301, '/docs/'));
  app.use('/docs', express.static(docsDist, { fallthrough: false, maxAge: '1h' }));
} else if (docsEnabled && !docsBuilt) {
  console.warn('[PHANTOM] user-docs enabled but not built. Run `npm run build:docs` to enable the /docs route.');
}

// Serve frontend
const distPath = join(ROOT, 'frontend');
if (existsSync(distPath)) {
  // React bundle assets (dist/react/assets/*) ship under /react/ when the
  // bundle exists. Mounting express.static here is a no-op when dist/react
  // is missing, so this is safe to leave in even before `npm run build:react`
  // has been invoked. The mount is unconditional w.r.t. REACT_PAGES because
  // individual asset URLs are referenced by hash from the React HTML.
  if (reactBundleAvailable) {
    app.use('/react', express.static(reactDistPath, { fallthrough: true, maxAge: '1h' }));
  }
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    // Excluded prefixes: API, WebSocket upgrade, and the docs route (if
    // mounted above — express.static handles it; the catch-all just
    // shouldn't intercept what's already served).
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/docs')) {
      return;
    }
    // React routing: if the requested page lives in REACT_PAGES AND the
    // React bundle has been built, hand the SPA shell to it. Otherwise
    // fall through to the legacy vanilla bundle exactly as before.
    if (reactBundleAvailable && REACT_PAGES.size > 0) {
      for (const prefix of REACT_PAGES) {
        if (req.path === prefix || req.path.startsWith(prefix + '/')) {
          return res.sendFile(reactIndexPath);
        }
      }
    }
    res.sendFile(join(distPath, 'index.html'));
  });
}

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('🔌 Client connected');

  // Track abort controller per connection for stop functionality
  let currentAbortController = null;
  let currentRunId = null;
  let currentRunStopped = false;
  // Pending approval round-trips. Key = approvalId (uuid-like).
  // Value = { resolve, timer, toolCallId }.
  // When the policy evaluator decides 'ask' or implicit-deny, the executor
  // calls requestApproval() which sends an approval_request WS message and
  // awaits the operator's approval_response. A 5-minute timeout auto-denies.
  const pendingApprovals = new Map();
  const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
  // Batch-approve state: when an operator ticks "approve next N matching",
  // we remember (scopeId, risk) → remaining count for this connection.
  // Subsequent ask-gated calls that match auto-approve until exhausted.
  // Resets on disconnect — the operator's approval doesn't carry across
  // sessions, by design.
  const batchApprovals = new Map(); // key: `${scopeId}::${risk}` → { remaining, originAppId }

  function providerRoute() {
    return (config.api.baseUrl || '').includes('127.0.0.1:8648') ? 'hermes-proxy' : config.api.baseUrl;
  }

  // Per-connection approval requester. The executor calls this when the
  // policy decides an action needs operator approval (ask gate or implicit
  // deny allow-once). We send the request to the client and resolve when
  // approval_response arrives — or auto-deny after APPROVAL_TIMEOUT_MS.
  function requestApproval(payload) {
    return new Promise((resolve) => {
      // Batch-approve short-circuit. If the operator pre-approved the next N
      // matching calls and this one matches, auto-resolve without rendering
      // a card. Only applies to ask-gates (not allow-once), so the operator
      // can't auto-bypass implicit denials.
      if (payload.kind === 'ask' && payload.scopeId && payload.risk) {
        const key = `${payload.scopeId}::${payload.risk}`;
        const batch = batchApprovals.get(key);
        if (batch && batch.remaining > 0) {
          batch.remaining -= 1;
          if (batch.remaining <= 0) batchApprovals.delete(key);
          resolve({
            approved: true,
            note: `batch-approve (${batch.originAppId}, ${batch.remaining} remaining)`,
            batch: true,
          });
          return;
        }
      }
      const approvalId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        if (pendingApprovals.has(approvalId)) {
          pendingApprovals.delete(approvalId);
          resolve({ approved: false, note: 'Operator approval timed out (5m)' });
        }
      }, APPROVAL_TIMEOUT_MS);
      pendingApprovals.set(approvalId, { resolve, timer, toolCallId: payload.toolCallId });
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'approval_request',
          approvalId,
          toolCallId: payload.toolCallId,
          name: payload.name,
          args: payload.args,
          kind: payload.kind,           // 'ask' | 'allow-once'
          risk: payload.risk,
          reason: payload.reason,
          gate: payload.gate,
          scopeId: payload.scopeId,
          scopeName: payload.scopeName,
          conversationId: currentConversationId,
          runId: currentRunId,
        }));
      } else {
        clearTimeout(timer);
        pendingApprovals.delete(approvalId);
        resolve({ approved: false, note: 'WebSocket closed before approval' });
      }
    });
  }
  let currentConversationId = null;

  function preview(value, max = 1200) {
    if (value === undefined || value === null) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > max ? `${text.substring(0, max)}…` : text;
  }

  function trace(runId, event) {
    try {
      return addTraceEvent(runId, event);
    } catch (err) {
      console.error('Trace persistence error:', err.message);
      return null;
    }
  }

  function sendTrace(runId, payload, event) {
    const traceEvent = trace(runId, event);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ ...payload, runId, traceEventId: traceEvent?.id, traceSeq: traceEvent?.seq }));
    }
    return traceEvent;
  }

  function exportTraceArtifact(runId, conversationId) {
    try {
      const artifact = exportRunTrace(runId, conversationId);
      trace(runId, {
        type: 'artifact.created',
        phase: 'artifact',
        status: 'completed',
        outputPreview: artifact.title,
        metadata: { artifactId: artifact.id, source: 'trace_export' },
      });
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'artifact_created', artifact: artifactToPublic(artifact, { includeMetadata: true }), runId, conversationId }));
      }
      return artifact;
    } catch (err) {
      console.error('Trace export error:', err.message);
      return null;
    }
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'approval_response': {
          // Operator clicked Approve/Deny on a chat approval card. Resolve
          // the pending promise so the executor unblocks. If the operator
          // ticked "approve next N matching", register the batch state so
          // future matching ask-gates auto-approve.
          const pending = pendingApprovals.get(msg.approvalId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingApprovals.delete(msg.approvalId);
            pending.resolve({
              approved: msg.decision === 'approve',
              note: msg.note || null,
            });
          }
          if (msg.decision === 'approve' && msg.batch && msg.batch.scopeId && msg.batch.risk) {
            const remaining = parseInt(msg.batch.remaining, 10) || 0;
            if (remaining > 0) {
              const key = `${msg.batch.scopeId}::${msg.batch.risk}`;
              batchApprovals.set(key, { remaining, originAppId: msg.approvalId });
            }
          }
          break;
        }

        case 'chat': {
          let conversationId = msg.conversationId;

          // Create new conversation if needed
          if (!conversationId) {
            const conv = createConversation('New Conversation');
            conversationId = conv.id;
            ws.send(JSON.stringify({ type: 'conversation_created', conversationId }));
          }
          // Make conversation/run ids visible to the per-connection
          // requestApproval closure so approval_request messages carry them.
          currentConversationId = conversationId;

          const selectedScope = msg.scopeId ? getScope(msg.scopeId) : null;
          const selectedProfileId = msg.profileId || null;
          const selectedToolpackIds = Array.isArray(msg.toolpackIds) ? msg.toolpackIds : (msg.toolpackIds ? String(msg.toolpackIds).split(',') : []);
          const operatorOverride = normalizeOperatorOverride(msg.operatorOverride);
          // UI context lets the agent answer "what am I looking at?" and
          // default phantom_* tool args. We inline the *full* scope summary
          // and toolpack metadata so the agent doesn't burn a tool round-trip
          // just to know what's authorized in this conversation.
          // Falls back to a minimal stub if the client didn't send one
          // (older clients still work).
          const toolpackMeta = selectedToolpackIds.length
            ? getToolpacks()
                .filter((tp) => selectedToolpackIds.includes(tp.id))
                .map((tp) => ({ id: tp.id, name: tp.name, risks: tp.risks, allowedActions: tp.allowedActions }))
            : [];
          const uiContext = msg.uiContext && typeof msg.uiContext === 'object'
            ? {
                route: msg.uiContext.route || null,
                selectedScopeId: msg.uiContext.selectedScopeId || selectedScope?.id || null,
                selectedAssetId: msg.uiContext.selectedAssetId || null,
                selectedRunId: msg.uiContext.selectedRunId || null,
                scope: selectedScope ? {
                  id: selectedScope.id,
                  name: selectedScope.name,
                  targets: selectedScope.targets,
                  allowed_actions: selectedScope.allowed_actions,
                  blocked_actions: selectedScope.blocked_actions,
                  expires_at: selectedScope.expires_at,
                } : null,
                toolpackIds: selectedToolpackIds,
                toolpacks: toolpackMeta,
                operatorOverride: operatorOverride.enabled ? operatorOverride : null,
              }
            : null;
          const governanceSnapshot = operatorOverride.enabled
            ? { policyMode: 'operator-override', operatorOverride }
            : { policyMode: 'governed' };
          const resolvedPrompt = resolvePrompt({
            basePrompt: buildSystemPrompt({ raw: true }),
            profileId: selectedProfileId,
            scopeId: selectedScope?.id || null,
            toolpackIds: selectedToolpackIds,
          });

          const run = createRun({
            conversationId,
            title: (msg.content || 'New Run').substring(0, 80),
            goal: msg.content,
            model: config.api.model,
            providerRoute: providerRoute(),
            scopeId: selectedScope?.id || null,
            promptSnapshot: {
              ...resolvedPrompt.snapshot,
              governance: governanceSnapshot,
              model: config.api.model,
              providerRoute: providerRoute(),
            },
          });

          // Tag the new run with the active goal so synthesis-time
          // auto-progress can attribute the outcome cleanly. Best-effort:
          // a missing goal_id column or partial migration must not break
          // the chat loop.
          try {
            const activeGoalId = getCurrentGoalId();
            if (activeGoalId) tagRunWithGoal(run.id, activeGoalId);
          } catch { /* non-fatal */ }

          currentRunId = run.id;
          currentRunStopped = false;
          let runHadError = false;

          // Create a new AbortController for this request
          currentAbortController = new AbortController();
          const abortSignal = currentAbortController.signal;

          // Signal start of response
          sendTrace(run.id,
            { type: 'response_start', conversationId },
            {
              type: 'run.started',
              phase: 'chat',
              status: 'started',
              outputPreview: preview(msg.content),
              metadata: {
                conversationId,
                model: config.api.model,
                providerRoute: providerRoute(),
                scopeId: selectedScope?.id || null,
                profileId: selectedProfileId,
                toolpackIds: selectedToolpackIds,
                policyMode: governanceSnapshot.policyMode,
                ...(operatorOverride.enabled ? { operatorOverride } : {}),
              },
            }
          );

          await processMessage(
            conversationId,
            msg.content,
            // onChunk — stream text
            (chunk) => {
              sendTrace(run.id,
                { type: 'chunk', content: chunk, conversationId },
                { type: 'assistant.chunk', phase: 'assistant', status: 'completed', outputPreview: preview(chunk) }
              );
            },
            // onToolCall — tool being called
            (toolCall) => {
              sendTrace(run.id,
                { type: 'tool_call', ...toolCall, conversationId },
                {
                  type: 'tool.call.started',
                  phase: 'tool',
                  status: 'started',
                  toolName: toolCall.name,
                  input: toolCall.args,
                  metadata: { toolCallId: toolCall.id },
                }
              );
            },
            // onToolResult — tool result
            (toolResult) => {
              const payload = { type: 'tool_result', ...toolResult, conversationId };
              const toolTrace = sendTrace(run.id,
                payload,
                {
                  type: 'tool.call.completed',
                  phase: 'tool',
                  status: 'completed',
                  toolName: toolResult.name,
                  outputPreview: preview(toolResult.result),
                  metadata: { toolCallId: toolResult.id },
                }
              );

              if (toolResult.name === 'show_preview_window') {
                try {
                  const resultObject = typeof toolResult.result === 'string' ? JSON.parse(toolResult.result) : toolResult.result;
                  if (resultObject?.html_content) {
                    const artifact = writePreviewArtifact({
                      runId: run.id,
                      conversationId,
                      title: resultObject.title || 'Preview',
                      htmlContent: resultObject.html_content,
                      traceEventId: toolTrace?.id || null,
                    });
                    payload.artifact = artifactToPublic(artifact, { includeMetadata: true });
                    trace(run.id, {
                      type: 'artifact.created',
                      phase: 'artifact',
                      status: 'completed',
                      outputPreview: artifact.title,
                      metadata: { artifactId: artifact.id, source: 'show_preview_window' },
                    });
                    if (ws.readyState === ws.OPEN) {
                      ws.send(JSON.stringify({ type: 'artifact_created', artifact: payload.artifact, runId: run.id, conversationId }));
                    }
                  }
                } catch (err) {
                  console.error('Preview artifact persistence error:', err.message);
                }
              }
            },
            // onError
            (error) => {
              runHadError = true;
              sendTrace(run.id,
                { type: 'error', message: error, conversationId },
                { type: 'run.error', phase: 'error', status: 'failed', outputPreview: preview(error) }
              );
            },
            // onThinking — AI reasoning/thinking tokens
            (thinkingChunk) => {
              sendTrace(run.id,
                { type: 'thinking', content: thinkingChunk, conversationId },
                { type: 'assistant.thinking', phase: 'assistant', status: 'completed', outputPreview: preview(thinkingChunk) }
              );
            },
            // abortSignal
            abortSignal,
            // onToolProgress — live tool output streaming
            (progress) => {
              sendTrace(run.id,
                { type: 'tool_progress', ...progress, conversationId },
                {
                  type: 'tool.progress',
                  phase: 'tool',
                  status: 'running',
                  toolName: progress.name,
                  outputPreview: preview(progress.text),
                  metadata: { toolCallId: progress.id },
                }
              );
            },
            {
              scope: selectedScope,
              profileId: selectedProfileId,
              operatorOverride,
              enforceScope: true,
              trace: (event) => trace(run.id, event),
              uiContext,
              runId: run.id,
              requestApproval,
            }
          );

          currentAbortController = null;

          // Auto-generate title from first message
          const messages = getMessages(conversationId);
          const userMsgs = messages.filter(m => m.role === 'user');
          if (userMsgs.length === 1) {
            const title = userMsgs[0].content.substring(0, 60) + (userMsgs[0].content.length > 60 ? '...' : '');
            updateConversationTitle(conversationId, title);
            ws.send(JSON.stringify({ type: 'title_updated', conversationId, title }));
          }

          if (currentRunStopped) {
            updateRunStatus(run.id, 'stopped', { summary: 'Stopped by user' });
            sendTrace(run.id,
              { type: 'response_end', conversationId },
              { type: 'run.stopped', phase: 'chat', status: 'stopped', outputPreview: 'Stopped by user' }
            );
            exportTraceArtifact(run.id, conversationId);
            recordRunOutcomeAgainstGoal(run.id);
            finalizeRunForCampaign(run.id);
          } else if (runHadError) {
            failRun(run.id, 'Completed with error');
            sendTrace(run.id,
              { type: 'response_end', conversationId },
              { type: 'run.failed', phase: 'chat', status: 'failed', outputPreview: 'Completed with error' }
            );
            exportTraceArtifact(run.id, conversationId);
            recordRunOutcomeAgainstGoal(run.id);
            finalizeRunForCampaign(run.id);
          } else {
            completeRun(run.id, 'Completed');
            sendTrace(run.id,
              { type: 'response_end', conversationId },
              { type: 'run.completed', phase: 'chat', status: 'completed', outputPreview: 'Completed' }
            );
            exportTraceArtifact(run.id, conversationId);
            recordRunOutcomeAgainstGoal(run.id);
            finalizeRunForCampaign(run.id);
          }

          currentRunId = null;
          currentRunStopped = false;
          break;
        }

        case 'stop': {
          // Abort the current operation
          if (currentAbortController) {
            console.log('⏹ Stop requested by user');
            currentRunStopped = true;
            if (currentRunId) {
              updateRunStatus(currentRunId, 'stopped', { summary: 'Stop requested by user' });
              trace(currentRunId, {
                type: 'run.stop_requested',
                phase: 'chat',
                status: 'stopped',
                outputPreview: 'Stop requested by user',
              });
            }
            currentAbortController.abort();
            currentAbortController = null;
          }
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
      }
    } catch (err) {
      console.error('WebSocket error:', err);
      if (currentRunId) {
        failRun(currentRunId, err.message);
        trace(currentRunId, {
          type: 'run.error',
          phase: 'error',
          status: 'failed',
          outputPreview: preview(err.message),
        });
      }
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: err.message, runId: currentRunId || undefined }));
      }
      currentRunId = null;
      currentRunStopped = false;
    }
  });

  ws.on('close', () => {
    console.log('🔌 Client disconnected');
    // Resolve any pending approval prompts as denied so the executor
    // unblocks instead of hanging until the 5-minute timeout.
    for (const [_id, pending] of pendingApprovals) {
      try {
        clearTimeout(pending.timer);
        pending.resolve({ approved: false, note: 'Client disconnected' });
      } catch {}
    }
    pendingApprovals.clear();
    batchApprovals.clear(); // batch state is per-connection by design

    // Abort any running operation when client disconnects
    if (currentAbortController) {
      currentRunStopped = true;
      if (currentRunId) {
        updateRunStatus(currentRunId, 'stopped', { summary: 'Client disconnected' });
        trace(currentRunId, {
          type: 'run.stopped',
          phase: 'chat',
          status: 'stopped',
          outputPreview: 'Client disconnected',
        });
      }
      currentAbortController.abort();
      currentAbortController = null;
    }
  });
});

// ─── Boot panel ──────────────────────────────────────────────────────────────
// Kit-aligned startup output: hairline rule, cyan brand, labelled rows for
// workspace · model · api key · local / network / websocket URLs. Auto-fits to
// process.stdout.columns (clamped 60..96) and auto-detects LAN IPv4 interfaces
// via os.networkInterfaces() so no `<YOUR-LAN-IP>` placeholders ship anymore.
// ANSI is disabled when stdout is not a TTY (piped logs stay plain text).
function printBootPanel() {
  const useAnsi = process.stdout.isTTY === true;
  const c = useAnsi
    ? { dim: (s) => `\x1b[90m${s}\x1b[0m`, cy: (s) => `\x1b[36m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
    : { dim: (s) => s, cy: (s) => s, b: (s) => s };

  const cols = Math.min(96, Math.max(60, process.stdout.columns || 80));
  const rule = '─'.repeat(cols - 4);
  const label = (k) => c.dim(k.padEnd(12));

  const port = config.port;
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  const maskedKey = config.api.apiKey
    ? `${c.dim('••••')}${config.api.apiKey.slice(-4)}`
    : c.dim('not set');

  const providerId = config.api.provider || 'custom';
  const providerLabel = providerId === 'custom'
    ? `custom · ${config.api.baseUrl}`
    : `${providerId} · ${config.api.baseUrl}`;

  // Elevation: how the agent will escalate when a tool needs root.
  //   root (containerized) — uid 0 inside the container, sudo is a no-op
  //   sudo cached          — bare-metal POSIX + a stored sudo password
  //   sudo (interactive)   — bare-metal POSIX, password prompt required
  //                          (installer steps will fail without TTY until
  //                          the operator validates via Settings)
  //   admin (per-command)  — Windows; per-step Start-Process -Verb RunAs
  //                          affordances surface on failed installs.
  const isRoot = (typeof process.getuid === 'function' && process.getuid() === 0);
  let elevationLabel;
  if (isRoot) {
    elevationLabel = c.cy('root') + c.dim(' (containerized)');
  } else if (process.platform === 'linux' || process.platform === 'darwin') {
    elevationLabel = getSetting('sudo_password', '')
      ? c.cy('sudo') + c.dim(' (cached)')
      : c.cy('sudo') + c.dim(' (interactive)');
  } else if (process.platform === 'win32') {
    elevationLabel = c.cy('admin') + c.dim(' (per-command)');
  } else {
    elevationLabel = c.dim('user');
  }

  const lines = [];
  lines.push('');
  lines.push('  ' + c.b(c.cy('PHANTOM SEC')) + c.dim('  Governed AI · Security-Ops Cockpit'));
  lines.push('  ' + c.dim(rule));
  lines.push('');
  lines.push('  ' + label('workspace') + config.workspace);
  lines.push('  ' + label('provider')  + providerLabel);
  lines.push('  ' + label('model')     + (config.api.model || c.dim('unset')));
  lines.push('  ' + label('api key')   + maskedKey);
  lines.push('  ' + label('elevation') + elevationLabel);
  lines.push('');
  lines.push('  ' + label('local')     + c.cy(`http://localhost:${port}`));
  if (lan.length) {
    lines.push('  ' + label('network') + c.cy(`http://${lan[0]}:${port}`));
    for (let i = 1; i < lan.length; i++) {
      lines.push('  ' + ' '.repeat(12) + c.cy(`http://${lan[i]}:${port}`));
    }
  }
  lines.push('  ' + label('websocket') + c.cy(`ws://localhost:${port}/ws`));
  lines.push('  ' + c.dim(rule));
  lines.push('');

  console.log(lines.join('\n'));
}

// Start server
server.listen(config.port, '0.0.0.0', () => {
  printBootPanel();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n  shutting down PHANTOM...');
  closeDB();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDB();
  server.close();
  process.exit(0);
});
