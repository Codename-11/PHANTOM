# PHANTOM DEVLOG

## 2026-05-17 16:32 EDT — Phase 8 Asset Registry and Mitigation Reruns

- Added first-class operational asset persistence for networks, devices, services, web apps, URLs/domains, owners, environments, tags, notes, service/address records, and redacted credential references.
- Upgraded scopes so `targets.assetIds` can reference saved assets while preserving raw host/domain/CIDR/URL targets; policy evaluation expands asset targets before authorizing risky tool actions.
- Added durable findings/results linked to assets, runs, scopes, trace events, artifacts, and baseline snapshots.
- Added asset baseline/health snapshots with status, health score, finding counts, observations, artifact links, and captured timestamps.
- Added mitigation rerun templates and materialized rerun records that preserve source run/scope/profile metadata while reusing governed run safety checks instead of blindly replaying commands.
- Added before/after comparison APIs for snapshot deltas: health score, ports, finding counts, added/resolved findings, and summary text.
- Added REST APIs for assets, findings, snapshots, run templates, materialized reruns, and comparisons.
- Rebuilt the former Targets / Scope page into a desktop-first responsive Assets + Scope workspace with 3-panel layout, asset list/search/filter, asset detail inspector, findings/history/services/targets sections, scope builder with asset selection, and comparison view.
- Added Runs page action for creating a mitigation rerun from an existing run.
- Validation passed:
  - RED tests added first for asset CRUD/redaction, asset-backed scopes, findings/snapshots/comparisons, rerun templates, and API behavior.
  - `npm test` — 35/35 passing
  - `npm run build` — passing (legacy non-module script warnings remain)
  - `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing
  - `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
  - Live Asset Registry API/DB smoke passed and cleaned fixtures.
  - Playwright Assets + Scope UI smoke passed for asset detail, scope list, and comparison view.
  - `git diff --check` — passing

Notes:
- Credential reference inputs are redacted before persistence/display; API/UI responses expose `[REDACTED]` only.
- Reruns create governed run records/templates for mitigation verification; they do not bypass policy/scope evaluation or replay destructive commands directly.
- Graph integration is currently via run/snapshot links and existing run graph pages; richer asset/finding graph modes remain a later enhancement.

## 2026-05-17 15:25 EDT — Phase 7 Replay Guarantees

- Added restart/reopen regression coverage proving runs, ordered trace events, artifacts, scope metadata, and redacted prompt snapshots survive DB close/reopen.
- Added direct traced tool lifecycle guarantees: traced executor calls now emit `tool.call.started` plus terminal `tool.call.completed` / `tool.call.failed` / `tool.call.blocked` events when used outside the WebSocket live path.
- Added `/api/runs/:id/replay` to return a replay bundle: run, events, artifacts, graph, sequence checks, tool-call completeness, blocked/failed counts, and artifact counts.
- Hardened graph derivation with scope/prompt run metadata plus blocked/out-of-scope policy markers on tool, command, host, and edge nodes.
- Updated Runs UI to load historical runs from replay bundles, show replay completeness stats, scope/profile metadata, artifacts, and policy notes after refresh/restart.
- Updated Graph UI to show blocked node/edge styling, scope-aware run list labels, and blocked counts in graph stats.
- Fixed initial hash-route loading for Runs so direct `/#runs` loads historical replay data without needing a route change.
- Validation passed:
  - RED tests added first for DB restart replay, direct traced tool lifecycle, replay API, and blocked graph indicators.
  - `npm test` — 31/31 passing
  - `npm run build` — passing (legacy non-module script warnings remain)
  - `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing
  - `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
  - Live replay API/DB smoke passed and cleaned fixtures.
  - Playwright replay UI smoke passed for Runs replay card and Graph blocked indicators.
  - `git diff --check` — passing

Notes:
- The executor now owns durable lifecycle trace coverage for direct invocations; the WebSocket path opts out of duplicate lifecycle emission because it already broadcasts/persists live trace events.
- This phase does not add an approval queue or prompt fragment version history; those remain next-phase candidates.

## 2026-05-17 15:03 EDT — Phase 5/6 Governed Runs

- Added first-class `scopes`, `prompt_profiles`, and `prompt_fragments` SQLite tables plus CRUD helpers and APIs.
- Added conservative scope policy evaluation for tool actions: risk classification, URL/IP/domain/host:port extraction, CIDR/domain/host matching, expiry checks, and explicit blocked action classes.
- Wired scope gating into tool execution before commands run; blocked actions return a visible policy result and persist `tool.call.blocked` trace events without executing the underlying command.
- Extended run creation with nullable `scope_id`, scope summaries in run list/detail payloads, and redacted prompt/config/scope snapshots for replayability.
- Updated prompt resolution to layer base system prompt + profile/mode fragments + scope rules + policy/tool/custom fragments.
- Added scope/profile/fragment APIs and profile/scope-aware prompt preview.
- Updated vanilla UI:
  - Targets / Scope page for scope CRUD and chat scope selection.
  - Chat scope selector and warning.
  - Settings → Prompts profile/fragment editor and resolved preview.
  - Runs detail scope/profile snapshot metadata and highlighted block events.
- Validation passed:
  - RED tests added first for scope store, policy evaluator, prompt store/resolution, run snapshots, blocked tool execution, and API behavior.
  - `npm test` — 28/28 passing
  - `npm run build` — passing (existing non-module script bundle warnings remain)
  - `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing
  - `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
  - Live governed-run smoke passed: created test scope/profile/fragment, verified out-of-scope command blocked before execution, verified prompt preview/snapshot metadata, and removed fixture data.
  - Playwright governed UI smoke passed for Scope page, Chat scope selector, and Settings prompt editor.
  - `git diff --check` — passing

Notes:
- This phase intentionally implements block-and-explain, not a full approval queue/workflow.
- Scope matching is conservative and MVP-level; deeper service/finding/topology semantics remain future work.
- Prompt fragments are editable and snapshotted, but full version history/rollback remains future work.

## 2026-05-17 13:40 EDT — Phase 4 Live Graph MVP

- Added trace-derived graph derivation that builds run, tool, command, observed host/URL/port, artifact, and error nodes from persisted `runs`, `trace_events`, and `artifacts`.
- Added graph APIs: `/api/runs/:id/graph` for live derived graph state and `/api/runs/:id/artifacts/graph` for durable JSON graph snapshot artifacts.
- Added Graph page with run selector, SVG execution graph, node detail panel, live refresh from WebSocket trace/artifact events, and graph snapshot export.
- Enabled Runs page `Open graph` CTA for selected runs.
- Kept scope enforcement, prompt profile editing, ReactFlow migration, and advanced network topology modes deferred.
- Validation passed:
  - RED tests added first for graph derivation and graph API/snapshot behavior.
  - `node --test server/graph/graph-derive.test.js server/routes/api.test.js` — passing
  - `npm test` — 18/18 passing
  - `npm run build` — passing (existing non-module script bundle warnings remain)
  - `node --check server/graph/graph-derive.js server/routes/api.js frontend/js/*.js frontend/js/pages/*.js` — passing
  - `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
  - Playwright graph page smoke passed and saved `/tmp/phantom-graph-page.png`.

Notes:
- Graph state is currently derived on demand from trace/artifact data rather than materialized into graph tables.
- Observation extraction intentionally captures obvious URLs, IPs, domains, and host:port pairs only; deeper service/finding semantics belong in later topology/finding phases.

## 2026-05-17 12:23 EDT — Phase 3 Durable Artifacts

- Added first-class SQLite `artifacts` table plus store helpers for run-linked metadata.
- Added workspace-backed run directories under `workspace/runs/<run-id>/`, artifact files under `artifacts/`, and automatic `trace.jsonl` export artifacts on run completion.
- Added artifact storage/rendering helpers, metadata redaction for public API responses, report renderers, and evidence ZIP export.
- Converted `show_preview_window` from ephemeral iframe-only output into durable HTML artifact creation while preserving existing chat preview behavior.
- Added artifact APIs: `/api/artifacts`, `/api/artifacts/:id`, content/download endpoints, `/api/runs/:id/artifacts`, and run report/summary/evidence generation endpoints.
- Added Artifacts page with list/filter/detail/preview/download flows, plus run-detail artifact chips and completion CTAs for pentest report, executive summary, evidence bundle, and local preview.
- Left graph, scope enforcement, prompt profile editing, and external publish flow intentionally out of scope; graph/publish CTAs are disabled placeholders.
- Validation passed:
  - `npm test` — 17/17 passing
  - `npm run build` — passing (existing non-module script bundle warnings remain)
  - `node --check frontend/js/*.js frontend/js/pages/*.js` — passing
  - `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
  - Live API checks created/read markdown report, executive summary, evidence ZIP, and durable HTML preview artifacts without exposing filesystem paths in list responses.

Notes:
- Artifact list/detail responses expose stable `contentUrl`/`downloadUrl` handles instead of local workspace paths.
- Evidence bundle includes `run.json`, `trace.jsonl`, `artifacts.json`, and available artifact files.

## 2026-05-17 11:50 EDT — Phase 1/2 Cockpit substrate

- Added a lightweight frontend router and primary navigation for Chat, Runs, Graph, Artifacts, Targets/Scope, and Settings.
- Promoted configuration into a dedicated Settings/Admin page with tabs for Models, General, Agent Behavior, Prompts, Security/Scope, Tools/MCP/Skills, and Advanced.
- Kept the existing settings drawer as quick model/status access and preserved Hermes Proxy model routing/settings behavior.
- Added read-only system prompt preview via `/api/prompts/preview`.
- Added SQLite `runs` and append-only `trace_events` tables plus store helpers.
- Created one Run per chat request and persisted trace events before broadcasting existing WebSocket events.
- Added `/api/runs`, `/api/runs/:id`, and `/api/runs/:id/events` plus a Runs timeline page.
- Added persistence/API tests for run and trace event storage.
- Validation passed:
  - `npm test` — 13/13 passing
  - `npm run build` — passing
  - `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy

Notes:
- Artifacts, graph visualization, scope policy enforcement, and prompt profile editing remain intentionally out of scope for this slice.
- `phantom.service` was restarted after implementation to validate the live smoke path.
