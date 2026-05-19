# Agent loop

`processMessage` in `server/ai/llm-client.js` is the heart of every PHANTOM run. It's a single async function that streams a chat completion, executes any tool calls the model requests, and continues looping until the model produces a turn with no tool calls.

This page covers the shape of the loop, the bug it had to grow out of (the "one-and-done" early stop with Grok), and the safety bounds.

## The loop, at the top level

```text
loop:
  if iterations >= MAX_AGENT_ITERATIONS: stop
  if abortSignal.aborted: stop
  call provider with full message history + tool definitions, streaming
  drain stream:
    collect content chunks → fullContent
    collect tool_call deltas → toolCalls[]
    record finish_reason
  if no content AND no tool_calls: stop (stuck guard)
  if tool_calls: execute each, append results, continue loop
  else: save fullContent as assistant message, return
```

That's the whole shape. Iteration cap is **40**. Stuck guard returns a friendly message instead of looping forever on an empty completion.

## The Grok one-and-done bug

The OpenAI spec says: when a streaming completion ends and the model wants to call tools, the terminal chunk should carry `finish_reason: 'tool_calls'`. When it's done with a normal text turn, the terminal chunk should carry `finish_reason: 'stop'`.

Grok, the Hermes proxy, and several local OpenAI-compatible shims **emit `finish_reason: 'stop'` even when `tool_calls` deltas were in the same stream**. The earlier loop code checked `finish_reason === 'stop'` *inside* the stream-drain loop and `return`-ed immediately if it saw it. Result: the model said "I want to call `nmap`" — and the executor said "OK, done."

The fix was structural:

1. Move the stop decision **out** of the per-chunk loop.
2. Drain the full stream first, collecting content + tool_calls + finishReason.
3. **After** the stream ends, check `toolCalls.length` first. If any tool calls were assembled, execute them — regardless of what `finish_reason` claimed.
4. Only return on a clean text turn (no tool calls collected, content present, OR no tool calls and explicit `stop`).

The relevant block now reads:

```js
const filteredToolCalls = toolCalls.filter(tc => tc && tc.function?.name);
if (!fullContent && filteredToolCalls.length === 0) {
  // stuck guard
  return stuckMsg;
}
if (filteredToolCalls.length > 0) {
  // execute every tool call, append results, continue loop
  continue;
}
// no tool calls — clean text turn, return
return fullContent;
```

The previous code's `if (chunk.choices?.[0]?.finish_reason === 'stop') return fullContent` is gone.

## Iteration cap

`MAX_AGENT_ITERATIONS = 40` is the loop's hard ceiling. If the agent keeps producing tool calls round after round, the loop stops at 40 with a friendly chat message: *"Stopped after 40 tool rounds. Ask me to continue if more work remains."*

Why 40:

- Real recon engagements with chained tool calls (subdomain enum → live-host probe → port scan → service version → vuln template) hit 8–15 rounds comfortably. 40 leaves headroom.
- Pathological "always return a tool call" failure modes would burn provider quota indefinitely. The cap is the floor on damage.
- Small enough to terminate; large enough to never be the bottleneck in normal use.

The cap is exported so tests can assert against it:

```js
import { MAX_AGENT_ITERATIONS } from './llm-client.js';
```

## Stuck-state guard

Some providers return an empty completion when they shouldn't (rate-limited, context-overrun, internal hiccup). The previous loop would keep calling the same endpoint indefinitely. The fix:

```js
const filteredToolCalls = toolCalls.filter(tc => tc && tc.function?.name);
if (!fullContent && filteredToolCalls.length === 0) {
  const stuckMsg = lastFinishReason === 'length'
    ? '[PHANTOM] ⏹ Model response truncated (max_tokens). Increase max_tokens in Settings or split the request.'
    : '[PHANTOM] ⏹ Model returned an empty completion.';
  onChunk(stuckMsg);
  return stuckMsg;
}
```

If `finish_reason: 'length'` arrives, it's a max-tokens truncation — surfaced as a hint rather than a generic empty.

## Thinking / reasoning tokens

Some providers (DeepSeek, Claude through some proxies, models with explicit `<think>` blocks) emit reasoning separately from content. The loop handles three shapes:

- `delta.reasoning_content` / `delta.reasoning` — a dedicated field
- Inline `<think>...</think>` blocks in `delta.content`
- Regular `delta.content`

Reasoning is routed to `onThinking` so the chat UI can render it in a collapsible card. It's NOT included in the assistant message saved to history — that would re-feed reasoning into the next prompt and cost tokens twice.

## Approval round-trip

When the policy returns `mode: 'ask'` or implicit deny, the executor calls `options.requestApproval(payload)`. That's a per-WebSocket-connection function in `server/index.js` that:

1. Generates an `approvalId`.
2. Sends `{type: 'approval_request', ...}` over the WS to the browser.
3. Returns a promise.
4. Resolves the promise when an `approval_response` arrives back.
5. Times out after 5 minutes (auto-deny).

The loop doesn't know about WebSockets. It just `await`s the requestApproval call. Test paths can pass a stub function.

## Streaming behavior

The loop emits these callbacks during a stream:

- `onChunk(text)` — content tokens, escaped from `<think>` blocks
- `onThinking(text)` — reasoning tokens (any of the three shapes above)
- `onToolCall({id, name, args})` — when a tool call's args have been fully assembled
- `onToolResult({id, name, result})` — after the tool returned
- `onToolProgress({id, name, text})` — live output from a running tool (currently `execute_command` streams its child stdout/stderr)

The WebSocket handler in `server/index.js` translates each of these into a trace event + a WS message.

## Abort handling

The loop accepts an `AbortSignal`. The signal is checked:

- Before each iteration
- Between each chunk in the stream
- Before each tool call execution

When aborted, the loop:

1. Sends `[PHANTOM] ⏹ Operation stopped by user.` as the assistant content.
2. Persists that as the run's last assistant message.
3. Returns the abort message.

The browser's Stop button sets the abort flag. So does an unexpected WS disconnect (the handler clears `currentAbortController` on close).

## Why "unlimited tool iterations" was wrong

The earlier code claimed unlimited tool iterations in a comment but exited too early because of the finish-reason bug. The fix flipped both — added the cap, removed the early stop. The cap is the *intended* limit; the bug just hid behind the absence of a cap by stopping for other reasons.

If you find a real workflow that needs > 40 rounds in a single chat turn, file an issue. It's almost certainly a sign that the agent is stuck in a loop (re-fetching the same thing, never satisfied with a result) and the right fix is a better stop condition in the prompt, not a higher cap.

## Tests

Five tests in `server/ai/llm-client.test.js` exercise the loop against a scripted fake OpenAI server:

1. **Grok-style `stop` + tool_calls** — verifies the executor still runs the tool when `finish_reason: 'stop'` arrives alongside tool_calls.
2. **Multi-turn continuation** — three tool rounds, then a final text turn. Verifies the loop doesn't exit early.
3. **Iteration cap** — a script that always returns a tool call. Verifies the cap fires at 40.
4. **Empty completion** — verifies the stuck guard returns instead of looping.
5. **`finish_reason: 'length'`** — verifies the friendly truncation hint is surfaced.

Plus an end-to-end smoke (`server/e2e/full-run.test.js`) that drives processMessage against a scripted provider through the full executor → trace store → synthesis pipe.
