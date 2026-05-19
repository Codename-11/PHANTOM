# REST + WebSocket API

PHANTOM exposes ~30 endpoint groups under `/api` plus a single WebSocket at `/ws`. Everything is local — there's no auth layer because PHANTOM is single-machine by design.

::: warning Don't expose PHANTOM to the network
The Express server has no auth. Anything that can reach `http://localhost:1337/api` can drive the agent. If you need remote access, terminate TLS + auth in a reverse proxy in front of PHANTOM.
:::

## Settings

| Method | Path | Description |
|---|---|---|
| GET | `/api/settings` | Current provider, model, temperature, max_tokens, workspace, plus `apiKeySet`, `sudoConfigured`, `synthesisLlmEnabled` flags. API key is returned masked. |
| PUT | `/api/settings` | Update any subset. Accepts `provider`, `baseUrl`, `apiKey`, `model`, `temperature`, `maxTokens`, `sudoPassword`, `workspace`, `synthesisLlmEnabled`. |
| POST | `/api/settings/test` | Pings the configured provider with a small completion request. Returns `{success, message, model}`. |

## Providers + models

| Method | Path | Description |
|---|---|---|
| GET | `/api/providers` | Registry of OpenAI-compatible providers (id, name, baseUrl, suggestedModels, openaiCompatible, unavailable). |
| GET | `/api/models` | Live `/v1/models` probe of the configured provider, with the provider's `suggestedModels` as fallback. |

## Onboarding

| Method | Path | Description |
|---|---|---|
| GET | `/api/onboarding/status` | `{completed, firstRun, emptyState, signals: {conversations, scopes, runs, apiKey, provider, model}}`. |
| POST | `/api/onboarding/complete` | Sets the sticky completion flag. |
| POST | `/api/onboarding/reset` | Clears the flag (used by Settings → Advanced → Open wizard). |

## Scopes

| Method | Path | Description |
|---|---|---|
| GET | `/api/scopes` | List active scopes. `?includeArchived=true` to include archived. |
| GET | `/api/scopes/templates` | Built-in scope templates (Web Recon, etc.). |
| GET | `/api/scopes/roe-templates` | Rules-of-Engagement templates with full policy payloads (internal pentest, bug bounty, red team, lab/internal). |
| GET | `/api/scopes/roe-templates/:id` | A specific template. |
| GET | `/api/scopes/:id` | Scope detail. |
| POST | `/api/scopes` | Create. |
| PUT | `/api/scopes/:id` | Update. |
| POST | `/api/scopes/:id/archive` | Archive. |
| DELETE | `/api/scopes/:id` | Same as archive. |
| PATCH | `/api/scopes/:id/action-mode` | Patch one action class's mode (auto / ask / deny). |
| POST | `/api/scopes/parse-targets` | Parse pasted text into `{targets: [...], scopeFields: {hosts, cidrs, urls, domains}}`. |
| POST | `/api/scopes/evaluate-draft` | Dry-run policy evaluation against a draft scope without saving. |
| POST | `/api/scopes/:id/evaluate` | Dry-run against a saved scope. |

## Runs

| Method | Path | Description |
|---|---|---|
| GET | `/api/runs` | List recent runs. `?conversationId=`, `?includeCompleted=false`, `?limit=`. |
| GET | `/api/runs/:id` | Run detail with redacted snapshot + events + artifacts. |
| GET | `/api/runs/:id/events` | Trace events for the run. |
| GET | `/api/runs/:id/replay` | Replay bundle: run + events + artifacts + graph + per-step replay data. |
| GET | `/api/runs/:id/artifacts` | Artifacts for the run. |
| GET | `/api/runs/:id/graph` | Trace-derived graph state. |
| GET | `/api/runs/:id/synthesis` | End-of-run synthesis (v1 shape). Query params: `preview=stub`, `enrich=1`, `previousScore=N`. |
| POST | `/api/runs/:id/artifacts/graph` | Persist current graph state as a durable JSON artifact. |
| POST | `/api/runs/:id/artifacts/report` | Generate a markdown pentest report artifact. |
| POST | `/api/runs/:id/artifacts/summary` | Generate an executive summary artifact. |
| POST | `/api/runs/:id/artifacts/evidence` | Bundle all artifacts + trace into an evidence tarball artifact. |

## Trending

| Method | Path | Description |
|---|---|---|
| GET | `/api/trending/posture` | Posture trend across recent runs. `?scopeId=`, `?limit=12`, `?includeRecentRuns=false`. |

## Approvals

| Method | Path | Description |
|---|---|---|
| GET | `/api/approvals` | Approval events reconstructed from trace_events. `?decision=`, `?risk=`, `?scopeId=`, `?toolName=`, `?since=`. |
| GET | `/api/approvals/stats` | KPI counts + 14-day sparkline + by-risk breakdown. |

## Installer

| Method | Path | Description |
|---|---|---|
| GET | `/api/installer/status` | Host detection + per-tool availability + tier counts. |
| GET | `/api/installer/catalog` | Full tool catalog with per-backend package ids. |
| POST | `/api/installer/preview` | Resolve install commands for a tier or tool list without persisting. Body: `{tier: "base|offensive|blue"}` or `{toolIds: [...]}`. |
| POST | `/api/installer/request` | Create a pending install request. |
| GET | `/api/installer/requests` | List requests. `?status=pending`. |
| GET | `/api/installer/requests/:id` | Request detail. |
| POST | `/api/installer/requests/:id/approve` | Execute the install plan. |
| POST | `/api/installer/requests/:id/cancel` | Cancel a pending request. |

## Assets + findings

| Method | Path | Description |
|---|---|---|
| GET | `/api/assets` | List active assets. |
| GET | `/api/assets/:id` | Asset detail with findings + snapshots. |
| POST | `/api/assets` | Create. |
| PUT | `/api/assets/:id` | Update. |
| POST | `/api/assets/:id/archive` | Archive. |
| GET | `/api/assets/:id/snapshots` | List snapshots for an asset. |
| POST | `/api/assets/:id/snapshots` | Create a snapshot. |
| GET | `/api/findings` | List findings. `?assetId=`, `?runId=`, `?status=`, `?severity=`. |
| POST | `/api/findings` | Create. |
| PUT | `/api/findings/:id` | Update (triage). |

## Run templates + comparisons

| Method | Path | Description |
|---|---|---|
| GET | `/api/run-templates` | List rerun templates. |
| POST | `/api/run-templates` | Create from a source run id. |
| POST | `/api/run-templates/:id/runs` | Materialize a new run from a template. |
| GET | `/api/comparisons` | Snapshot comparisons. |
| POST | `/api/comparisons` | Create a comparison between two snapshots. |

## Toolpacks + tools

| Method | Path | Description |
|---|---|---|
| GET | `/api/toolpacks` | Curated security toolpacks. |
| GET | `/api/toolpacks/:id` | Toolpack detail. |
| GET | `/api/toolpacks/:id/availability` | Tool-by-tool PATH availability. |
| GET | `/api/tools` | LLM tool definitions (the agent's tool list). |

## Prompts

| Method | Path | Description |
|---|---|---|
| GET | `/api/prompts/preview` | Resolved system prompt for a given profile/scope/toolpacks. |
| GET | `/api/prompts/profiles` | List prompt profiles. |
| POST | `/api/prompts/profiles` | Create. |
| PUT | `/api/prompts/profiles/:id` | Update. |
| GET | `/api/prompts/fragments` | List fragments. |
| POST | `/api/prompts/fragments` | Create. |
| PUT | `/api/prompts/fragments/:id` | Update. |

## Artifacts

| Method | Path | Description |
|---|---|---|
| GET | `/api/artifacts` | List. `?runId=`, `?conversationId=`, `?type=`. |
| GET | `/api/artifacts/:id` | Metadata. |
| GET | `/api/artifacts/:id/content` | Raw content (served with the artifact's content-type). |
| GET | `/api/artifacts/:id/download` | Forced download. |

## Conversations + messages

| Method | Path | Description |
|---|---|---|
| GET | `/api/conversations` | List. |
| POST | `/api/conversations` | Create. |
| GET | `/api/conversations/:id` | Detail with messages. |
| DELETE | `/api/conversations/:id` | Delete (cascades to messages, runs, artifacts). |
| PUT | `/api/conversations/:id/title` | Rename. |

## MCP + skills

| Method | Path | Description |
|---|---|---|
| GET | `/api/mcp/servers` | List configured MCP servers. |
| POST | `/api/mcp/servers` | Add. |
| DELETE | `/api/mcp/servers/:id` | Remove. |
| GET | `/api/skills` | List installed skill packs. |
| POST | `/api/skills/upload` | Upload a skill `.zip`. |
| DELETE | `/api/skills/:name` | Remove. |

## Memory

| Method | Path | Description |
|---|---|---|
| GET | `/api/memory` | Search or list. `?query=`, `?category=`. |

## System + sudo

| Method | Path | Description |
|---|---|---|
| GET | `/api/system/info` | Host info + sudo configured flag. |
| POST | `/api/sudo/validate` | Validate + cache a sudo password (used by the installer's Linux mitigation). |

## AI Doctor

| Method | Path | Description |
|---|---|---|
| POST | `/api/doctor/chat` | Side-channel diagnostic chat with the user's own provider credentials (separate from PHANTOM's). Streams SSE. |

## WebSocket — `/ws`

Single endpoint. Browser opens one connection per page; the server tracks per-connection state (current run, current abort controller, pending approvals, batch-approval state).

### Client → server messages

| Type | Payload | What it does |
|---|---|---|
| `chat` | `{type, content, conversationId?, scopeId?, profileId?, toolpackIds?, operatorOverride?, uiContext?}` | Start a chat turn. Creates a run, calls processMessage, streams chunks back. |
| `stop` | `{type}` | Abort the current run. |
| `approval_response` | `{type, approvalId, decision: 'approve'\|'deny', note?, batch?: {scopeId, risk, remaining}}` | Resolve a pending approval. `batch` registers a "approve next N matching" rule for this connection. |
| `ping` | `{type}` | Heartbeat. |

### Server → client messages

| Type | Payload | Meaning |
|---|---|---|
| `conversation_created` | `{conversationId}` | A new conversation was created server-side (first chat message in a fresh session). |
| `response_start` | `{conversationId, runId, traceSeq}` | Run is starting. |
| `chunk` | `{content, runId, conversationId, traceSeq}` | Streamed model text. |
| `thinking` | `{content, runId, ...}` | Reasoning tokens. |
| `tool_call` | `{id, name, args, runId, ...}` | Agent called a tool. |
| `tool_result` | `{id, name, result, artifact?, runId, ...}` | Tool returned. |
| `tool_progress` | `{id, name, text, runId, ...}` | Streamed output from a running tool. |
| `approval_request` | `{approvalId, toolCallId, name, args, kind, risk, reason, gate, scopeId, scopeName, conversationId, runId}` | Operator needs to approve/deny. |
| `error` | `{message, runId, ...}` | Run error. |
| `artifact_created` | `{artifact, runId, conversationId}` | A durable artifact was written. |
| `title_updated` | `{conversationId, title}` | Server auto-titled the conversation from the first message. |
| `pong` | `{}` | Heartbeat reply. |

### Approval round-trip

```text
Client                                    Server
  │                                          │
  │  chat { content: "scan 10.0.0.0/24" }    │
  ├─────────────────────────────────────────▶│
  │                                          │  evaluateToolAction → mode:'ask'
  │       approval_request { ... }           │
  │◀─────────────────────────────────────────┤
  │                                          │
  │  approval_response { decision: 'approve',│
  │                      note: 'lab run' }   │
  ├─────────────────────────────────────────▶│
  │                                          │  executor runs the tool
  │       tool_result { ... }                │
  │◀─────────────────────────────────────────┤
```

If the operator doesn't respond within 5 minutes, the server auto-resolves with `{approved: false, note: 'Operator approval timed out (5m)'}`.

## Versioning

PHANTOM is local-first and the API isn't versioned. Schema-relevant endpoints emit `v: 1` in their JSON payload (synthesis, trending) so future shape changes can be additive. Breaking changes will rev the `v` and ship migration notes in DEVLOG.
