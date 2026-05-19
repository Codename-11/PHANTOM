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
import { writePreviewArtifact, exportRunTrace } from './artifacts/artifact-store.js';
import { artifactToPublic } from './artifacts/renderers.js';
import apiRouter from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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

// Serve frontend
const distPath = join(ROOT, 'frontend');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(join(distPath, 'index.html'));
    }
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

  function providerRoute() {
    return (config.api.baseUrl || '').includes('127.0.0.1:8648') ? 'hermes-proxy' : config.api.baseUrl;
  }

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
        case 'chat': {
          let conversationId = msg.conversationId;

          // Create new conversation if needed
          if (!conversationId) {
            const conv = createConversation('New Conversation');
            conversationId = conv.id;
            ws.send(JSON.stringify({ type: 'conversation_created', conversationId }));
          }

          const selectedScope = msg.scopeId ? getScope(msg.scopeId) : null;
          const selectedProfileId = msg.profileId || null;
          const selectedToolpackIds = Array.isArray(msg.toolpackIds) ? msg.toolpackIds : (msg.toolpackIds ? String(msg.toolpackIds).split(',') : []);
          const operatorOverride = normalizeOperatorOverride(msg.operatorOverride);
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
          } else if (runHadError) {
            failRun(run.id, 'Completed with error');
            sendTrace(run.id,
              { type: 'response_end', conversationId },
              { type: 'run.failed', phase: 'chat', status: 'failed', outputPreview: 'Completed with error' }
            );
            exportTraceArtifact(run.id, conversationId);
          } else {
            completeRun(run.id, 'Completed');
            sendTrace(run.id,
              { type: 'response_end', conversationId },
              { type: 'run.completed', phase: 'chat', status: 'completed', outputPreview: 'Completed' }
            );
            exportTraceArtifact(run.id, conversationId);
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

  const lines = [];
  lines.push('');
  lines.push('  ' + c.b(c.cy('PHANTOM SEC')) + c.dim('  Governed AI · Security-Ops Cockpit'));
  lines.push('  ' + c.dim(rule));
  lines.push('');
  lines.push('  ' + label('workspace') + config.workspace);
  lines.push('  ' + label('provider')  + providerLabel);
  lines.push('  ' + label('model')     + (config.api.model || c.dim('unset')));
  lines.push('  ' + label('api key')   + maskedKey);
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
