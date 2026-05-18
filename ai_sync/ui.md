# AI Sync - UI

## What we have

- Vanilla JS + Vite frontend with the implemented PHANTOM SEC UI kit: cool-slate SOC command-center shell, cyan system accent, operator-dense 13px body scale, compact cards/tables, restrained elevation, line/mono glyphs, and no matrix/emoji hacker chrome.
- Primary navigation for Chat, Runs, Graph, Artifacts, Assets / Scope, and Settings, plus a keyboard-friendly `Ctrl/⌘+K` command palette for core routes/actions.
- Chat command center with real-time markdown streaming over WebSocket, active scope selector, active toolpack visibility, and live tool output.
- Runs page with historical run list/detail, persisted event timeline, artifacts, scope/profile/toolpack metadata, blocked policy decisions, replay completeness, and mitigation-rerun CTAs.
- Artifacts page for durable reports, previews, trace exports, graph snapshots, summaries, and evidence bundles.
- Graph page with trace-derived nodes/edges, orthogonal paths, pan/zoom/fit/reset controls, live follow/pause, replay controls, readable labels, blocked-policy styling, and node detail output/artifact cards.
- Targets / Scope workspace with asset registry, asset detail inspector, findings/history sections, Scope Builder, smart target parsing, editable chips, asset-backed/raw targets, intent templates, comparisons, and dry-run policy preview.
- Settings/Admin page with populated tabs for General, Models, Agent Behavior, Prompts, Security / Scope, Tools / MCP / Skills, and Advanced diagnostics.
- Preview panel capable of rendering generated HTML/CSS/JS beside chat while also creating durable artifacts.

## What we want

- Approval queue UI for high-risk governed actions that should wait for operator confirmation.
- Prompt fragment version history, diff, reset, and rollback controls.
- More graph modes for asset/finding/network views beyond the execution/replay graph.
- Better responsive tuning for dense Scope Builder chips and graph detail panels on small screens.
- Artifact publishing adapter once local durable artifacts remain stable.
- Accessibility pass for keyboard navigation, focus states, and screen-reader labeling across admin-heavy pages.

## What is done

- The old single chat/settings surface has been promoted into a multi-page operational cockpit.
- Settings tabs no longer render as empty placeholders; presenter-rendered admin cards expose the current governed-run, prompt, toolpack, and diagnostics state.
- UI smoke coverage exists for graph viewer behavior and settings/toolpack population, alongside Node tests for frontend presenters/helpers.
