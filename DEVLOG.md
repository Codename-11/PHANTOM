# PHANTOM DEVLOG

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
