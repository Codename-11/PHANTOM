# AI Sync - Performance

## What we have

- WebSocket-based chat and trace broadcasting for responsive live runs.
- Asynchronous backend command handling where routes/tools need to avoid blocking the event loop.
- Trace-first persistence so Runs, Graph, and Artifacts can be reconstructed from SQLite/workspace state after refresh or restart.
- On-demand graph derivation from persisted runs, trace events, and artifacts; graph snapshots can be exported as durable JSON artifacts when needed.
- Frontend presenter/helper modules for Settings, Scope Builder, and Graph layout so UI-heavy behavior can be tested without a browser.
- Toolpack availability checks are exposed through API endpoints and surfaced in Settings.

## What we want

- Better incremental markdown rendering for very long streamed messages; current whole-message re-rendering can become expensive on large outputs.
- Lazy loading or virtualization for very long run timelines, artifact lists, and graph replay step strips.
- Structured tool observations so graph extraction and replay summaries require less repeated text parsing.
- Optional caching for expensive graph/replay bundles once run data is immutable.
- More deterministic browser smoke tests for dense asset/scope and settings states.

## What is done

- Replaced earlier blocking backend patterns with async execution in key paths.
- Added durable run/replay APIs so expensive UI views can request bounded historical bundles instead of reconstructing state only from live browser memory.
- Added frontend unit tests and smoke coverage around graph layout/replay and settings/toolpack rendering.
