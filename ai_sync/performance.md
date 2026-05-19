# AI Sync - Performance

## What we have

- WebSocket-based chat and trace broadcasting for responsive live runs.
- Asynchronous backend command handling where routes/tools need to avoid blocking the event loop.
- Trace-first persistence so Runs, Graph, and Artifacts can be reconstructed from SQLite/workspace state after refresh or restart.
- On-demand graph derivation from persisted runs, trace events, and artifacts; graph snapshots can be exported as durable JSON artifacts when needed.
- Frontend presenter/helper modules for Settings, Scope Builder, Graph layout, **Synthesis card**, and **Installer panel** so UI-heavy behavior can be tested without a browser.
- Toolpack availability checks are exposed through API endpoints and surfaced in Settings; results are computed via a pure-Node `process.env.PATH` walk with a per-process cache (`server/utils/has-command.js`) so per-prompt rebuilds don't spawn `which` repeatedly.
- **Agent loop iteration cap** (`MAX_AGENT_ITERATIONS = 40`) keeps a pathological loop from burning quota indefinitely. Stuck-state guard exits early on empty completions instead of spinning.
- **Synthesis-card data shape (v1)** is reused across three surfaces (Runs Synthesis tab, Onboarding wizard preview, Trending dashboard rows) — one builder, one renderer, no parallel derivation paths to drift.
- **Posture trending** chains `previousScore` so the entire sparkline + per-entry delta is built in a single pass over the synthesis list.
- **Cross-shell test runner** (`scripts/run-tests.js`) walks `server/` and `frontend/js/` for `*.test.js` files instead of relying on shell glob expansion (PowerShell does not expand `**` the way bash does).
- Trace event chunks emitted by streaming assistant replies are aggregated client-side in Runs (170+ chunk events per turn collapse into one expandable summary row) so the timeline stays scannable.

## What we want

- Better incremental markdown rendering for very long streamed messages; current whole-message re-rendering can become expensive on large outputs.
- Lazy loading or virtualization for very long run timelines, artifact lists, and graph replay step strips.
- Structured tool observations so graph extraction and replay summaries require less repeated text parsing.
- Optional caching for expensive graph/replay bundles once run data is immutable.
- Cache LLM-synthesis enrichment per-run instead of regenerating on each `/api/runs/:id/synthesis` fetch.
- More deterministic browser smoke tests for dense asset/scope and settings states.
- WebSocket-layer test coverage (`server/index.js` `wss.on('connection'...)`) — currently uncovered because `initDB()` runs at import time.

## What is done

- Replaced earlier blocking backend patterns with async execution in key paths.
- Added durable run/replay APIs so expensive UI views can request bounded historical bundles instead of reconstructing state only from live browser memory.
- Added frontend unit tests and smoke coverage around graph layout/replay and settings/toolpack rendering.
- Added an end-to-end smoke (`server/e2e/full-run.test.js`) that drives `processMessage` against a scripted fake provider so loop / executor / trace-store / synthesis regressions are caught before manual testing.
- Added render tests for synthesis-card and installer-panel using a 50-line manual DOM stub — full coverage without a jsdom dependency.
- Test suite is now split into unit / e2e / watch modes (`npm run test:unit`, `npm run test:e2e`, `npm run test:watch`) so iteration loops can skip the slower E2E.
- Approval round-trip timeout (5 minutes) keeps a hung operator-approval card from blocking the executor indefinitely.
