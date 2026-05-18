# PHANTOM DEVLOG

## 2026-05-17 21:44 EDT — Password Audit Capability Split

- Split password-audit governance into distinct `offline-password-audit` and `online-bruteforce` risk classes so local John/Hashcat/hashid/name-that-hash workflows can use hash files and wordlists without granting live login/brute-force capability.
- Added RED coverage proving offline password audits with local hash + wordlist paths are allowed when explicitly authorized, while Hydra-style online auth testing remains blocked unless the selected scope allows `online-bruteforce` for the target. Broad legacy `credentialed` allowlists no longer authorize the new password-audit subclasses.
- Added Basic/Kali capability metadata to security toolpacks and prompt snapshots. Offline Password Audit now exposes Basic local audit and Kali local wordlist/rule tooling; Credentialed Service Audit is a separate scoped online-auth toolpack with Basic and Kali levels.
- Updated Settings toolpack cards to surface capability levels and updated README, repo security sync notes, and Obsidian PHANTOM docs/decisions/spec/plan with the capability split.

Validation passed:
- RED: `node --test server/scope/policy.test.js server/toolpacks/toolpack-registry.test.js` failed before implementation on missing `offline-password-audit`, `online-bruteforce`, and Basic/Kali metadata assertions.
- GREEN targeted: `node --test server/scope/policy.test.js server/toolpacks/toolpack-registry.test.js frontend/js/pages/settings-page-presenter.test.js` — 14/14 passing.
- Integration targeted: `node --test server/scope/policy.test.js server/toolpacks/toolpack-registry.test.js server/prompts/prompt-store.test.js server/routes/api.test.js frontend/js/pages/settings-page-presenter.test.js` — 21/21 passing.
- `npm test` — 58/58 passing.
- `npm run build` — passing with existing Vite non-module warnings.
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing.
- `python3 tests/smoke_test.py` — 4/4 passing.
- Restarted `phantom.service`; live `/api/toolpacks` now returns 7 packs including `credentialed-service-audit`, and post-restart `python3 tests/smoke_test.py` remains 4/4 passing.
- `git diff --check` — passing.

## 2026-05-17 21:31 EDT — Scope Policy Local Wordlist False Positive Fix

- Fixed a scope-policy false positive where command arguments like `-P wordlist.txt` in Hydra runs were extracted as remote domain targets because `wordlist.txt` matched the generic domain regex.
- Added local-file argument detection for common wordlist/request/config/output flags (`-P`, `-L`, `-C`, `-w`, `--wordlist`, `-iL`, `-oN`, `-r`, etc.) so file-like values are excluded from remote target matching while actual hosts/IPs/host:port values remain governed.
- Added a regression test for an in-scope Hydra SMB command using a local wordlist against `172.16.24.12:445`; the policy now evaluates the credentialed action against the SMB target instead of blocking on the local wordlist filename.

Validation passed:
- RED: `node --test server/scope/policy.test.js` failed before the fix with `Target wordlist.txt is outside selected scope`.
- GREEN: `node --test server/scope/policy.test.js` — passing.
- Direct policy smoke returned allowed with targets `172.16.24.12` and `172.16.24.12:445`, excluding `wordlist.txt`.
- `npm test` — 54/54 passing.
- `npm run build` — passing with existing Vite non-module warnings.
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing.
- `python3 tests/smoke_test.py` — 4/4 passing.
- `git diff --check` — passing.

## 2026-05-17 21:25 EDT — Governed Operations Documentation Refresh

- Rewrote `README.md` around the current local-first governed security-ops cockpit: scoped autonomous runs, policy gates, prompt profiles, toolpacks, trace replay, graph, artifacts, Assets / Scope, and populated Settings/Admin surfaces.
- Refreshed `ai_sync/security.md`, `ai_sync/ui.md`, and `ai_sync/performance.md` so repo-local notes no longer describe governed scopes/prompts as future-only work.
- Updated Obsidian PHANTOM refs (`SPEC.md`, `Structural Enhancement Plan.md`, `DECISIONS.md`, and index sync timestamp) with Scope Builder, security toolpacks, settings population, and resolved decision context.
- Updated the public fork metadata for `Codename-11/PHANTOM` with the governed-operations description and current topics.

Validation passed:
- Grep check found no stale unsafe README/ai_sync phrasing such as `Unlimited Operations`, `No tool call limits`, or sample `sk-` API keys.
- Grep check confirmed governed terms are present across README, ai_sync notes, and Obsidian PHANTOM refs.
- GitHub metadata readback confirmed the new description and topics.
- `npm test` — 53/53 passing.
- `npm run build` — passing with existing Vite non-module warnings.
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing.
- `python3 tests/smoke_test.py` — 4/4 passing.
- `git diff --check` — passing.

## 2026-05-17 21:13 EDT — Settings Admin Panel Population Fix

- Fixed the empty-looking Settings tabs after the governed toolpack phase by adding explicit presenter-rendered content for General, Agent Behavior, Security / Scope, Tools / MCP / Skills, and Advanced.
- Added a Settings page presenter with unit coverage so admin panels render non-empty operator-facing cards instead of placeholders.
- Added a timeout/error state for `/api/toolpacks` so a stale backend process shows an actionable restart message instead of leaving the Tools panel blank.
- Restarted the PHANTOM dev service so Express reloaded the new `/api/toolpacks` route; live API now returns six toolpacks.
- Verified the Settings page with Playwright: all settings tabs render populated content and Tools shows six toolpack cards.

Validation passed:
- `node --test frontend/js/pages/settings-page-presenter.test.js`
- Playwright settings tab smoke against `http://127.0.0.1:5173/#settings`
- `npm test` — 53/53 passing
- `npm run build` — passing (legacy non-module script warnings remain)
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing
- `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
- `git diff --check` — passing

## 2026-05-17 20:31 EDT — Scope Builder and Security Toolpacks

- Upgraded the Assets / Scope workspace into a guided governed Scope Builder with intent templates, smart pasted-target parsing, editable target chips, asset-backed and raw target fields, toolpack defaults, and dry-run policy preview using the same evaluator that gates real tool execution.
- Added conservative target parsing for URLs, domains, IPs, CIDRs, and host:port values, including public/private labels and scope-field expansion for API/UI import flows.
- Added curated built-in security toolpacks for Passive OSINT, Web Recon, Network Discovery, Web Vulnerability Assessment, Offline Password Audit, and Reporting. Each registry entry declares tools, availability checks, install hints, risk classes, scope requirements, output parser names, playbook prompt text, and policy gates.
- Extended prompt resolution and run snapshots with selected toolpack prompt fragments and redacted toolpack metadata while preserving the existing base + profile/mode + scope/rules + policy/tool/custom ordering.
- Added `/api/scopes/templates`, `/api/scopes/parse-targets`, `/api/scopes/evaluate-draft`, `/api/toolpacks`, `/api/toolpacks/:id`, and `/api/toolpacks/:id/availability` for guided scope creation and toolpack administration.
- Surfaced active scope and selected toolpacks across Chat, Settings prompt preview, Toolpacks/Security settings, Runs detail, and Graph metadata so operators can see which governance context produced a run.
- Preserved scope/risk enforcement before execution: expired, denied, out-of-scope, destructive, online brute-force, and credentialed classes remain blocked unless scope policy explicitly allows them, and blocked actions persist trace events without running commands.

Validation passed:
- `npm test` — 51/51 passing
- `npm run build` — passing (legacy non-module script warnings remain)
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing
- `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
- `git diff --check` — passing

Notes:
- Toolpack availability checks only report installed commands and install hints; they do not install or execute tools.
- Secrets remain redacted in config/prompt/scope snapshots and UI metadata.

## 2026-05-17 17:28 EDT — Graph Replay and Readability Pass

- Added replay presentation steps to `/api/runs/:id/replay`: ordered trace steps now include readable titles, primary graph node IDs, related node/edge IDs, output previews, policy explanations, risk metadata, and linked artifacts without exposing secrets.
- Upgraded the Graph page with replay prev/play/next controls, a replay timeline strip, active node/edge following, output preview cards, and artifact chips so operators can walk the actual trace path instead of only viewing the static graph.
- Added graph presentation helpers for human-readable tool names, readable edge explanations, wrapped/titled node labels, and redacted metadata rows.
- Improved long-node handling by widening graph nodes and rendering labels across two SVG lines with full labels preserved in titles/details.
- Enhanced the graph smoke test to verify replay controls, readable Shell command labels, active replay highlighting, output previews, and wrapped node labels.

Validation passed:
- `npm test` — 42/42 passing
- `npm run build` — passing (legacy non-module script warnings remain)
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing
- `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
- `python3 tests/graph_viewer_smoke.py` — passing; screenshot at `/tmp/phantom-graph-viewer-first-class.png`
- `git diff --check` — passing

Notes:
- Replay remains trace-derived; no second graph source of truth or materialized graph table was added.
- Metadata display is summarized/redacted for operator readability while raw replay bundles still use the existing sanitized API objects.

## 2026-05-17 17:08 EDT — Graph Viewer Operational Canvas

- Promoted the Graph page from a scrollable SVG panel into a first-class operational viewer with a fitted pan/zoom canvas, fit/reset controls, zoom controls, and no internal canvas scrollbars.
- Replaced Bezier graph links with orthogonal 90-degree connector paths plus lane offsets for parallel edges, preserving blocked/policy path styling.
- Added live-watch behavior for active runs: WebSocket trace/artifact events track the current live run, auto-follow can select the active run, and users can pause/resume follow for historical inspection.
- Added graph layout helper tests for orthogonal paths, graph bounds, and fit-to-view transforms; `npm test` now includes frontend graph tests.
- Added deterministic graph viewer smoke fixture and Playwright smoke covering blocked paths, artifact nodes, fit/zoom/follow controls, live indicator state, and no page/canvas overflow.

Validation passed:
- `npm test` — 38/38 passing
- `npm run build` — passing (legacy non-module script warnings remain)
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing
- `python3 tests/smoke_test.py` — 4/4 passing against Hermes routed proxy
- `python3 tests/graph_viewer_smoke.py` — passing; screenshot at `/tmp/phantom-graph-viewer-first-class.png`
- `git diff --check` — passing

Notes:
- Graph remains trace-derived from persisted runs, trace events, and artifacts; no frontend-only graph state or materialized graph tables were introduced.
- Asset/finding topology graph modes remain a future enhancement.

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
