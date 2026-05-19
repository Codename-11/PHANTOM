# AI Sync - UI

## What we have

- Vanilla JS + Vite frontend with the implemented PHANTOM SEC UI kit: cool-slate SOC command-center shell, cyan system accent, operator-dense 13px body scale, compact cards/tables, restrained elevation, line/mono glyphs, and no matrix/emoji hacker chrome.
- Primary navigation for Dash (default landing), Chat, Runs, Graph, Alerts, Artifacts, Approvals, Assets / Scope, and Settings, plus a keyboard-friendly `Ctrl/⌘+K` command palette for core routes/actions. Last-visited route persisted to localStorage; reloads restore it (Settings is the one `noRestore` route so reloads always re-land on Dash).
- Chat command center with real-time markdown streaming over WebSocket, active scope selector, active toolpack visibility, and live tool output.
- Runs page with historical run list/detail, persisted event timeline, artifacts, scope/profile/toolpack metadata, blocked policy decisions, replay completeness, and mitigation-rerun CTAs. **Synthesis tab is the headline** — canonical v1 data shape with posture donut (0–100 + rating + delta), objective met/partial/unmet, activity counts, posture-component bars, findings severity bar, highlights, and clickable next-step buttons routing to Rerun / Summary / Approvals / Alerts / Scope. Synthesis tab flashes (`flash-ping`) when a watched run terminates.
- Artifacts page for durable reports, previews, trace exports, graph snapshots, summaries, and evidence bundles.
- Graph page with trace-derived nodes/edges, orthogonal paths, pan/zoom/fit/reset controls, live follow/pause, replay controls, readable labels, blocked-policy styling, and node detail output/artifact cards.
- **Approvals page** — single governance queue. Pending sec-ops install requests render as their own card kind above the KPI strip (approve/cancel inline; status syncs with Settings → Tools). KPI strip + 14-day sparkline + by-risk breakdown + filterable event list cover scope-gated ask events, allow-once, override, denied, and timeout decisions.
- **Dash** with cockpit KPI strip + live runs panel + untriaged alerts + policy decisions + toolpack availability + asset health movers + **posture-trending panel** (sparkline of recent run scores with dots color-coded by rating, by-scope mini-list, recent-runs timeline using `SynthesisCard.renderCompactRow`).
- **First-run onboarding wizard** — auto-opens on a fresh install via `/api/onboarding/status`; 4-step modal (welcome → provider/key with live `/v1/models` probe → first scope using ROE templates → live preview of the synthesis card with stub data). Sticky completion flag; re-runnable from Settings → Advanced → Open wizard.
- **Sec-Ops Installer panel** (Settings → Tools) — host detection card (OS, distro, docker, package manager probes with green/red dots and a "preferred" badge), three tier cards (base · recon/OSINT, offensive · red team, blue · defense/DFIR) with installed/total counts and "Install missing" / "Preview commands" buttons. Per-tool dots + docs links inline. Install requests render with a status pill, package list, command preview, and per-step result table showing exit codes, classification (`ok | timeout | admin | failed | skipped`), and a **Copy elevated cmd** affordance when privilege failures are detected. Existing toolpack cards now decorate each tool row with a green/red availability dot driven by the same installer status data.
- Targets / Scope workspace with asset registry, asset detail inspector, findings/history sections, Scope Builder, smart target parsing, editable chips, asset-backed/raw targets, intent templates, comparisons, and dry-run policy preview.
- Settings/Admin page with populated tabs for General, Models, Agent Behavior, Prompts, Security / Scope, Tools / MCP / Skills (Sec-Ops Installer), and Advanced diagnostics (onboarding re-launch, LLM-synthesis flag toggle).
- Preview panel capable of rendering generated HTML/CSS/JS beside chat while also creating durable artifacts.
- Toast affordance (`#installer-toast`) for short-lived status feedback shared by installer flows.

## What we want

- Prompt fragment version history, diff, reset, and rollback controls.
- More graph modes for asset/finding/network views beyond the execution/replay graph.
- Better responsive tuning for dense Scope Builder chips and graph detail panels on small screens.
- Artifact publishing adapter once local durable artifacts remain stable.
- Accessibility pass for keyboard navigation, focus states, and screen-reader labeling across admin-heavy pages.
- Caching the LLM-synthesis enrichment per-run instead of regenerating on each `/api/runs/:id/synthesis` fetch.
- Per-tool install verb (currently the tier-level "Install missing" button covers the common case but a per-tool install isn't surfaced).

## What is done

- The old single chat/settings surface has been promoted into a multi-page operational cockpit.
- Settings tabs no longer render as empty placeholders; presenter-rendered admin cards expose the current governed-run, prompt, toolpack, and diagnostics state.
- UI smoke coverage exists for graph viewer behavior and settings/toolpack population, alongside Node tests for frontend presenters/helpers.
- Synthesis card and installer panel have render tests against a 50-line DOM stub (`frontend/js/test-dom-stub.js`), no jsdom/linkedom dependency.
- Approvals queue is the single governance surface; pending install requests route through the same page as scope-gated tool calls.
- CSS is append-only: Pass 25 (Synthesis card) → Pass 26 (Onboarding wizard) → Pass 27 (Trending) → Pass 28 (Friction polish) → Pass 29 (Installer cards/host detection) → Pass 30 (Settings toggle / Approvals install card / privilege failure pill / Copy-elevated button).
