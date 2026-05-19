import { getToolDefinitions } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { buildSystemPrompt } from './system-prompt.js';
import { normalizeOperatorOverride } from '../scope/policy.js';
import { addMessage, getMessages, saveMemory, searchMemories, saveToolResult } from '../memory/store.js';
import config, { updateConfig } from '../config.js';
import OpenAI from 'openai';

let openaiClient = null;

function getClient() {
  if (!openaiClient || openaiClient._baseURL !== config.api.baseUrl) {
    openaiClient = new OpenAI({
      apiKey: config.api.apiKey || 'sk-placeholder',
      baseURL: config.api.baseUrl,
    });
  }
  return openaiClient;
}

export function resetClient() {
  openaiClient = null;
}

// Hard upper bound on the agent loop. Generous so real engagements with
// many tools (recon → enumeration → exploit → report) can complete, but
// finite so a pathological model can't burn quota forever. 40 iterations
// = ~40 tool-call rounds in the worst case.
export const MAX_AGENT_ITERATIONS = 40;

/**
 * Process a user message: send to LLM with tools, handle tool calls recursively, stream responses.
 * Supports:
 *  - Up to MAX_AGENT_ITERATIONS tool rounds per turn
 *  - AbortSignal for stopping mid-operation
 *  - Thinking/reasoning token detection
 *  - Live tool output streaming via onToolProgress
 *  - Tolerance for providers (Grok, several local shims) that emit
 *    finish_reason='stop' alongside tool_calls instead of the spec's
 *    finish_reason='tool_calls'.
 */
export async function processMessage(conversationId, userMessage, onChunk, onToolCall, onToolResult, onError, onThinking, abortSignal, onToolProgress, options = {}) {
  const operatorOverride = normalizeOperatorOverride(options.operatorOverride);

  // Get conversation history
  const history = getMessages(conversationId);

  // Build messages array.
  // The system prompt now takes a uiContext bundle so the agent knows what
  // page the operator is on and which scope/asset/run is selected. Without
  // it the agent was blind to PHANTOM's UI state and couldn't answer
  // "what's on screen?" or default phantom_* tool args correctly.
  const messages = [
    { role: 'system', content: buildSystemPrompt({
      profileId: options.profileId || null,
      scopeId: options.scope?.id || options.scopeId || null,
      uiContext: options.uiContext || null,
    }) },
  ];

  // Add memory context
  if (operatorOverride.enabled) {
    messages.push({
      role: 'system',
      content: `## OPERATOR OVERRIDE MODE\nThe operator has explicitly enabled Operator Override for this test run. PHANTOM will still classify risk and persist audit trace events, but scope/target policy gates are bypassed before tool execution. Reason: ${operatorOverride.reason}`,
    });
  }

  try {
    const relevantMemories = searchMemories(userMessage);
    if (relevantMemories.length > 0) {
      const memoryContext = relevantMemories.map(m => `[${m.category}] ${m.key}: ${m.value}`).join('\n');
      messages.push({
        role: 'system',
        content: `## RELEVANT MEMORIES\n${memoryContext}`,
      });
    }
  } catch {}

  // Add conversation history (limit to last 50 messages to stay in context window)
  // Limit history to last 40 messages to keep context window lean
  const recentHistory = history.slice(-40);
  for (const msg of recentHistory) {
    const m = { role: msg.role, content: msg.content };
    if (msg.tool_calls) m.tool_calls = msg.tool_calls;
    if (msg.tool_call_id) {
      m.tool_call_id = msg.tool_call_id;
      m.role = 'tool';
    }
    if (msg.name) m.name = msg.name;
    messages.push(m);
  }

  // Add the new user message
  messages.push({ role: 'user', content: userMessage });
  addMessage(conversationId, { role: 'user', content: userMessage });

  // Pre-fetch tool definitions once (don't re-fetch every loop iteration)
  const tools = getToolDefinitions();
  const client = getClient();

  // Iteration cap protects against pathological loops (model that keeps
  // calling tools forever, or providers that never emit a final stop).
  // The previous code documented "unlimited" but in practice exited too
  // early because finish_reason=='stop' returned even with tool_calls
  // pending — see the if-block guard below.
  let iterations = 0;
  let lastFinishReason = null;
  while (true) {
    if (iterations >= MAX_AGENT_ITERATIONS) {
      const capMsg = `[PHANTOM] ⏹ Stopped after ${MAX_AGENT_ITERATIONS} tool rounds. Ask me to continue if more work remains.`;
      onChunk(capMsg);
      addMessage(conversationId, { role: 'assistant', content: capMsg });
      return capMsg;
    }
    iterations += 1;

    // Check if aborted
    if (abortSignal?.aborted) {
      const abortMsg = '[PHANTOM] ⏹ Operation stopped by user.';
      onChunk(abortMsg);
      addMessage(conversationId, { role: 'assistant', content: abortMsg });
      return abortMsg;
    }

    try {
      const response = await client.chat.completions.create({
        model: config.api.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: config.api.temperature,
        max_tokens: config.api.maxTokens,
        stream: true,
      });

      let fullContent = '';
      let thinkingContent = '';
      let toolCalls = [];
      let isInThinkBlock = false;
      let finishReason = null;

      for await (const chunk of response) {
        // Check abort between chunks
        if (abortSignal?.aborted) {
          const abortMsg = '[PHANTOM] ⏹ Operation stopped by user.';
          onChunk(abortMsg);
          addMessage(conversationId, { role: 'assistant', content: abortMsg });
          return abortMsg;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          // Some providers send terminal chunks with no delta (just a
          // finish_reason). Still record the reason so the post-stream
          // decision logic sees it.
          if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
          continue;
        }

        // Handle reasoning/thinking tokens (DeepSeek, Claude, etc.)
        // Some models send reasoning in a separate field
        if (delta.reasoning_content || delta.reasoning) {
          const thinkText = delta.reasoning_content || delta.reasoning;
          thinkingContent += thinkText;
          if (onThinking) onThinking(thinkText);
          continue;
        }

        // Handle text content — detect <think> blocks inline
        if (delta.content) {
          const text = delta.content;

          // Check for <think> block opening
          if (text.includes('<think>')) {
            isInThinkBlock = true;
            const parts = text.split('<think>');
            if (parts[0]) {
              fullContent += parts[0];
              onChunk(parts[0]);
            }
            if (parts[1]) {
              thinkingContent += parts[1];
              if (onThinking) onThinking(parts[1]);
            }
            continue;
          }

          // Check for </think> block closing
          if (text.includes('</think>')) {
            isInThinkBlock = false;
            const parts = text.split('</think>');
            if (parts[0]) {
              thinkingContent += parts[0];
              if (onThinking) onThinking(parts[0]);
            }
            if (parts[1]) {
              fullContent += parts[1];
              onChunk(parts[1]);
            }
            continue;
          }

          // Route to thinking or content
          if (isInThinkBlock) {
            thinkingContent += text;
            if (onThinking) onThinking(text);
          } else {
            fullContent += text;
            onChunk(text);
          }
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
            }
          }
        }

        // Record the finish reason — but do NOT decide whether to stop
        // here. The decision happens after the stream drains so we can
        // also see whether tool_calls were assembled. Grok routinely
        // emits finish_reason='stop' alongside tool_calls in the same
        // chunk (the OpenAI spec says 'tool_calls' but several
        // OpenAI-compatible providers don't comply); the previous code
        // returned immediately on 'stop' and never executed those calls.
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      lastFinishReason = finishReason;

      // Stuck-state guard: empty content AND empty tool_calls. Indicates
      // an upstream provider returned an empty completion. Looping again
      // would burn quota for no benefit — record the state and exit.
      const filteredToolCalls = toolCalls.filter(tc => tc && tc.function?.name);
      if (!fullContent && filteredToolCalls.length === 0) {
        const stuckMsg = lastFinishReason === 'length'
          ? '[PHANTOM] ⏹ Model response truncated (max_tokens). Increase max_tokens in Settings or split the request.'
          : '[PHANTOM] ⏹ Model returned an empty completion.';
        onChunk(stuckMsg);
        addMessage(conversationId, { role: 'assistant', content: stuckMsg });
        return stuckMsg;
      }

      // If we have tool calls, execute them — even when the provider
      // reported finish_reason='stop'. The presence of tool_calls is the
      // canonical signal that the model wants to call tools.
      if (filteredToolCalls.length > 0) {
        toolCalls = filteredToolCalls;
        // Save assistant message with tool calls
        const assistantMsg = { role: 'assistant', content: fullContent || null, tool_calls: toolCalls };
        addMessage(conversationId, assistantMsg);
        messages.push(assistantMsg);

        // Execute each tool call
        for (const tc of toolCalls) {
          if (!tc || !tc.function?.name) continue;

          // Check abort before each tool execution
          if (abortSignal?.aborted) {
            const abortMsg = '[PHANTOM] ⏹ Operation stopped by user.';
            onChunk(abortMsg);
            addMessage(conversationId, { role: 'assistant', content: abortMsg });
            return abortMsg;
          }

          let args = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch (e) {
            args = { raw: tc.function.arguments };
          }

          onToolCall({ id: tc.id, name: tc.function.name, args });

          const startTime = Date.now();
          let result;
          try {
            // Pass onToolProgress for live output streaming.
            // conversationId + runId + uiContext are forwarded so phantom_*
            // tools can default to the live run when the LLM omits them.
            // requestApproval is the gate hook: when policy returns
            // mode:'ask' or implicit-deny, the executor pauses on
            // options.requestApproval(...) until the operator decides in chat.
            result = await executeTool(tc.function.name, args, (progressText) => {
              if (onToolProgress) onToolProgress({ id: tc.id, name: tc.function.name, text: progressText });
            }, {
              scope: options.scope || null,
              enforceScope: options.enforceScope !== false,
              operatorOverride,
              trace: options.trace,
              emitLifecycle: false,
              toolCallId: tc.id,
              conversationId,
              runId: options.runId || null,
              uiContext: options.uiContext || null,
              requestApproval: options.requestApproval || null,
            });
          } catch (e) {
            result = `Error: ${e.message}`;
          }
          const duration = Date.now() - startTime;

          // Truncate very long results
          const maxResultLen = 15000;
          let truncatedResult = result;
          if (typeof result === 'string' && result.length > maxResultLen) {
            truncatedResult = result.substring(0, maxResultLen) + `\n\n... [truncated, ${result.length - maxResultLen} chars omitted]`;
          }

          onToolResult({ id: tc.id, name: tc.function.name, result: truncatedResult });

          // Save tool result
          saveToolResult(conversationId, tc.function.name, args, truncatedResult, 'success', duration);

          // Add tool result to messages
          const toolMsg = { role: 'tool', content: truncatedResult, tool_call_id: tc.id, name: tc.function.name };
          addMessage(conversationId, toolMsg);
          messages.push(toolMsg);
        }

        // Continue the loop — let the LLM process tool results
        continue;
      }

      // No tool calls. The stream produced text-only content → the model
      // is done with this turn. finishReason should be 'stop' or 'length'
      // here in practice; either way we save what we have and exit. If
      // finishReason is 'length' the operator is responsible for asking
      // for continuation in their next message.
      if (fullContent) {
        addMessage(conversationId, { role: 'assistant', content: fullContent });
      }
      return fullContent;

    } catch (error) {
      // If aborted, don't show as error
      if (abortSignal?.aborted) {
        const abortMsg = '[PHANTOM] ⏹ Operation stopped by user.';
        onChunk(abortMsg);
        return abortMsg;
      }
      const errMsg = `LLM Error: ${error.message}`;
      onError(errMsg);
      addMessage(conversationId, { role: 'assistant', content: errMsg });
      return errMsg;
    }
  }
}

/**
 * One-shot, non-streaming completion that asks the model for JSON and
 * parses the result. Used by feature paths that need a structured object
 * back (synthesis enrichment, classification, etc.) rather than a chat
 * stream. Throws if the response isn't valid JSON — callers are expected
 * to wrap in try/catch and fall back to their non-LLM path.
 *
 * Honors:
 *   - the configured provider/model
 *   - an optional abortSignal
 *   - an optional max_tokens override (default 1024 — small for JSON)
 */
export async function llmCompleteJson({ system, user, maxTokens = 1024, abortSignal = null } = {}) {
  if (!user) throw new Error('llmCompleteJson requires a user prompt');
  const client = getClient();
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  // response_format=json_object is the OpenAI/Hermes way to force JSON.
  // Providers that don't support it ignore the field; we still try to
  // parse and fall back to bracket-matching extraction.
  const response = await client.chat.completions.create({
    model: config.api.model,
    messages,
    temperature: 0.2,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  }, abortSignal ? { signal: abortSignal } : undefined);

  const text = response.choices?.[0]?.message?.content || '';
  // Try strict JSON first; if the model wrapped it in fences or prose,
  // pull the largest {...} substring as a best-effort fallback.
  try { return JSON.parse(text); } catch {
    const open = text.indexOf('{');
    const close = text.lastIndexOf('}');
    if (open >= 0 && close > open) {
      return JSON.parse(text.substring(open, close + 1));
    }
    throw new Error('llmCompleteJson: model did not return parseable JSON');
  }
}

/**
 * Test API connection
 */
export async function testConnection() {
  try {
    const client = getClient();
    const response = await client.chat.completions.create({
      model: config.api.model,
      messages: [{ role: 'user', content: 'Say "PHANTOM online" in exactly 2 words.' }],
      max_tokens: 20,
    });
    return { success: true, message: response.choices[0]?.message?.content || 'Connected', model: config.api.model };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
