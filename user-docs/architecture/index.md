# Architecture

PHANTOM is a single-process Express server with a Vanilla JS frontend, backed by SQLite. There's no microservice split, no message bus, no managed dependency. The interesting work happens in three layers:

1. **Persistence layer.** `server/memory/store.js` owns the SQLite schema, CRUD helpers, and normalization. Every run, scope, trace event, artifact, approval, and install request lives here.

2. **Reasoning layer.** `server/ai/llm-client.js` runs the agent loop. `server/ai/system-prompt.js` builds the layered system prompt. `server/tools/executor.js` dispatches tool calls through the scope policy gate.

3. **Surface layer.** `server/routes/api.js` is one big Express router exposing the REST API. `server/index.js` adds WebSocket upgrade + chat orchestration. The frontend talks to both.

```text
                            ┌─────────────────────┐
   Browser (vanilla JS) ◀─▶ │  HTTP API (routes)  │ ──▶ SQLite
                            │  WebSocket (index)  │
                            └──────┬──────────────┘
                                   │
                            ┌──────▼──────────┐
                            │  Agent loop     │
                            │  (llm-client)   │
                            └──┬──────────────┘
                               │
                            ┌──▼──────────────┐     ┌──────────────────┐
                            │  Executor       │ ─▶  │  Scope policy    │
                            │  (dispatch)     │ ◀─  │  evaluator       │
                            └──┬──────────────┘     └──────────────────┘
                               │
                            ┌──▼──────────────┐
                            │  Tool impls     │
                            │  (shell, http,  │
                            │  python, etc.)  │
                            └─────────────────┘
```

## Core flow per chat turn

1. Browser sends `{type: 'chat', content, scopeId, ...}` over WebSocket.
2. `server/index.js` creates a run row in SQLite with the prompt snapshot.
3. Emits `run.started` trace event.
4. Calls `processMessage(...)` from `llm-client.js`.
5. processMessage builds the full message array (system prompt + memories + history + user) and calls the LLM with streaming.
6. As tool_calls arrive in the stream, processMessage waits for the stream to drain, then calls `executeTool(...)` for each.
7. executeTool classifies the action, evaluates against scope, runs the tool (or blocks/asks/overrides).
8. Tool result is appended to messages; the loop continues.
9. When the model returns a turn with no tool calls (and content), the loop exits.
10. `run.completed` trace event is emitted; the run is marked complete in SQLite.
11. Synthesis is rendered from the trace events on demand.

## Key design choices

**Trace-first, not state-first.** The frontend doesn't hold canonical state. Every surface (Runs, Graph, Artifacts, Synthesis, Trending) is derived from `trace_events` rows. Refresh the page, restart the server — everything reconstructs from SQLite.

**One canonical synthesis shape.** The end-of-run synthesis v1 schema is the single source of truth across three surfaces: per-run card, onboarding wizard preview, trending dashboard rows. One builder, one renderer, no parallel paths.

**Append-only CSS passes.** Frontend visual evolution happens in numbered append-only "passes" (Pass 25 onward in the most recent session). Every pass header announces the scope and rationale. No rewrites — diffs are easier to review.

**Pure-function detection where possible.** Host detection, package-manager probes, installer catalog, synthesis builder — all pure functions with deterministic outputs given inputs. Pure functions are testable without spawning subprocesses or mocking DOM.

**Approval round-trip lives on the WebSocket.** Pending approvals are per-connection state in `server/index.js`. Disconnect = approval cancelled. That keeps approval state from leaking across operator sessions.

**Scope policy is the gate, not the prompt.** The agent's system prompt enumerates the policy and what each outcome means, but the actual block happens in `evaluateToolAction` *before* the tool runs. We don't rely on the agent to be obedient.

## Deep dives

- [Governance model](/architecture/governance) — scope policy, action classes, the four outcomes, trace event vocabulary.
- [Agent loop](/architecture/agent-loop) — streaming, tool_calls handling, the Grok one-and-done bug, iteration cap, stuck-state guard.

## Where the code lives

```text
server/
├── ai/
│   ├── llm-client.js       # processMessage, llmCompleteJson, 40-iter loop
│   ├── system-prompt.js    # buildSystemPrompt + host-context block
│   └── providers.js        # OpenAI-compatible provider registry
├── memory/
│   └── store.js            # SQLite schema + all normalize/CRUD helpers
├── routes/
│   └── api.js              # ~30 endpoint groups, one router
├── runs/
│   ├── synthesis.js        # buildRunSynthesis, enrichSynthesisWithLLM
│   ├── trending.js         # getPostureTrend
│   └── replay.js           # buildRunReplay
├── scope/
│   ├── policy.js           # evaluateToolAction, action-class classification
│   ├── scope-store.js
│   ├── rate-limiter.js
│   └── target-parser.js
├── tools/
│   ├── executor.js         # dispatch + scope gate + trace emission
│   ├── installer.js        # detectHost, resolveInstallPlan
│   ├── installer-catalog.js
│   ├── phantom-tools.js    # phantom_* domain tools
│   └── registry.js         # tool definitions for the LLM
├── onboarding/onboarding.js
└── index.js                # Express + WebSocket bootstrap
```
