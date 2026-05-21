# PHANTOM UI Enhancement Plan — React Parity with the SEC UI Kit

**Status:** active · **Created:** 2026-05-21 · **Goal:** restore the React frontend to the
"PHANTOM SEC UI kit" concept that the pre-React build had reached.

Design source of truth (extracted handoff bundle):
`.design-fetch-v3/_full/phantom-sec-ui-kit/project/kit/` — `tokens.css`, `kit.css`,
`primitives.jsx`, `shell.jsx`, and `screens/*.jsx`. Chat intent: `chats/chat1.md`, `chat2.md`.

---

## 1. Diagnosis — what "minified" during the A8.x React migration

The React port preserved the **app shell** (sidebar glyph-nav, ⌘K trigger, scope strip,
breadcrumbs) but flattened the two layers beneath it:

### Layer 1 — Design tokens (~57 of ~90 dropped)
`frontend/src/styles/globals.css` kept only surfaces/lines/fg + a single cyan accent. The
A8.1 Tailwind config (see `tailwind.config.ts` comment) deliberately aliased shadcn's generic
token names (`card`, `muted`, `accent`) onto cool-slate vars for "pixel-identical" rendering.
That worked for surfaces but discarded everything **semantic**:

- **Severity scale** — `--sev-{crit,high,med,low,info,ok}` × `{fg,bg,line}` (only `danger/warn/ok` survived)
- **Governance** — `--policy`, `--policy-bg`, `--policy-line`, `--redacted`
- **Scales** — spacing `--s-1..14`, radii `--r-1..pill`, font-size `--fs-9..44`, line-heights
- **Density** — `--row-{sm,md,lg}`, `--ctl-h`, `--ctl-h-sm`, `data-density="compact"`
- **Motion / elevation** — `--ease`, `--t-{snap,fast,base}`, `--elev-1..3`, `--ring-focus`
- **Interaction tints** — `--bg-{hover,pressed,selected,stripe}`, `--cy-tint(-strong)`, `--line-cy`, `--fg-mono-ts`

### Layer 2 — Component anatomy (kit primitives never ported)
The kit (`primitives.jsx` + `kit.css`) is a set of semantic CSS classes with thin React
wrappers. The React app rebuilt everything as Tailwind-utility/shadcn generics, so the kit's
signature components don't exist: `Panel` (gradient header), `Stat` (divider metric card),
`SevTick` (3px severity edge), `Chip`/`TargetChip` (mono k/v), `AlertRow`, segmented
`ButtonGroup`, `Kv` grid, `.timeline/.evt` trace grammar.

### Per-screen regression (worst → least)

| Screen | React file | Kit ref | Gap summary |
|---|---|---|---|
| **Dash** | `pages/Dash.tsx` | `cockpit.jsx` | Most regressed. Missing toolpack-availability, asset-health-movers, policy-decision bars/top-reasons; live-runs + untriaged flattened to link-pills (no row grid, no sev-tick) |
| **Asset Profile** | *(none)* | `asset-profile.jsx` | Page does not exist: identity / health / findings / services / scope-membership all absent |
| **Alerts** | `pages/Alerts.tsx` | `alert-queue.jsx` | Flex layout not dense `.tbl`; no sev-tick; drawer missing Policy / PoC / Suggested-Fix + Trace/History tabs; `ok` severity dropped |
| **Runs** | `pages/Runs.tsx` | `run-detail.jsx` | Timeline has no inline `.cmd` blocks, no `.reason` policy lines, no `.kv` redacted-metadata drawer |
| **Graph** | `pages/Graph.tsx` | `graph.jsx` | No legend, straight edges (not orthogonal), no node kind-badges/sub-text, no inspector drawer, no replay marker, sparse toolbar |
| **Scope** | `pages/ScopeCreate.tsx` | `scope-builder.jsx` | Dry-run policy-preview drawer missing; action-matrix + target-chips flattened |

---

## 2. Strategy

**Reuse the source of truth directly.** The kit *is* CSS. Rather than re-derive the look in
Tailwind utilities, we (a) restore the full token set, (b) port the kit's component classes
verbatim into the React stylesheet (minus its global `*` reset / `html,body` rules, which would
fight Tailwind preflight), and (c) add thin React primitives that emit those classes. Screens
then **compose primitives** instead of improvising. This maximizes fidelity and minimizes the
chance of drift.

**Topology.** Foundation is serial and blocks everything. The six screens are mutually
independent → parallel agents.

```
F1 tokens ┐
F2 css    ├─→ F4 verify ─→ ┌ S1 Dash      ┐
F3 prims  ┘                 ├ S2 Alerts    │
                            ├ S3 Runs      ├─→ Final verify
                            ├ S4 Graph     │
                            ├ S5 Scope     │
                            └ S6 AssetProfile ┘
```

---

## 3. Workstreams

### Foundation (serial — owner: orchestrator)

**F1 · Tokens** (`globals.css`, `tailwind.config.ts`) — port every missing token from
`kit/tokens.css` into the `:root` block; add `data-density`/`data-theme` overrides; extend
Tailwind `borderRadius`/`fontSize`/`colors` to expose the new scales to utilities.

**F2 · Component CSS** (`frontend/src/styles/kit-components.css`, new) — port kit.css component
classes: `.panel*`, `.stat`, `.badge` severity/policy variants + `.dot`, `.sev-tick`, `.chip(.target)`,
`.tabs/.tab/.count`, `.tbl` (dense/zebra), `.alert-row`, `.timeline/.evt` (+ `.cmd`/`.reason`),
`.cmdk`, `.drawer*`, `.kv`, `.bar`, `.spark`, `.empty`, `.skeleton`, `.spinner`, misc helpers.
Import from `main.tsx` after `globals.css`. **Do not** port the `*` reset or `html,body` block.

**F3 · Primitives** (`frontend/src/components/ui/`) — mirror `primitives.jsx`: `Panel`, `Stat`,
`SevTick`, `Chip`, `TargetChip`, `Bar`, `Spark`, `Kv`, `ButtonGroup`/`SegGroup`. Refactor
`SeverityBadge.tsx` to add `ok` and the full bg/line variants. Match existing forwardRef/cva style.

**F4 · Verify** — `npm run build:react` + `npm run test:frontend` green before screens start.

### Screens (parallel — one agent each, all `blockedBy: F4`)

- **S1 Dash → cockpit** (`pages/Dash.tsx`): KPI `Stat` strip · live-runs row grid · untriaged
  rows w/ `SevTick` · policy-decisions-24h `Bar` breakdown + top-reasons · toolpack-availability
  `Panel` · asset-health-movers `Bar`.
- **S2 Alerts → alert-queue** (`pages/Alerts.tsx`): dense `.tbl` (sev-tick edge, mono cyan IDs,
  hover row-actions, selected cyan inset) · drawer w/ Evidence/Asset/Trace/History tabs, `Kv` grid,
  Policy Decision panel, PoC pre-block (red left border), Suggested-Fix list. Restore `ok` severity.
- **S3 Runs → run-detail** (`components/TraceTimeline.tsx`, `pages/Runs.tsx`): `.evt` colored nodes
  (blocked=purple/failed=red/ok=green/tool=cyan-filled) · inline `.cmd` blocks · `.reason` lines ·
  persistent right `Kv` metadata drawer (run/scope/prompt/artifacts).
- **S4 Graph** (`components/GraphCanvas.tsx`, `pages/Graph.tsx`, `lib/graph.ts`): legend overlay ·
  orthogonal edges · policy-block dashes · node kind-badges + sub-text · active/replay marker ·
  grid bg · zoom widget overlay · node inspector drawer · toolbar chrome.
- **S5 Scope builder** (`pages/ScopeCreate.tsx`, `pages/Scope.tsx`): `.chip.target` mono-first chips ·
  allow/ask/deny action matrix · dry-run policy-preview drawer (counts + `Bar` + sample rows) ·
  scope detail → `Kv` grid.
- **S6 Asset Profile** (`pages/AssetProfile.tsx`, new; route in `App.tsx`): identity `Kv` panel ·
  health-score panel + sparkline + severity-distribution grid · open-findings `.tbl` · services
  table · scope-membership list. Wire to asset/registry API; degrade gracefully if endpoints absent.

### Final
Full build + tests, launch app, capture 1440×900 screenshots per screen, compare to concept,
log to `DEVLOG.md`.

---

## 4. Guardrails for every agent

- **Tokens, not literals.** Use `var(--sev-*)` / kit classes; never hard-code hex.
- **Severity-only warm colors.** Cyan is the single system accent; amber/red/green are semantic only.
- **Mono as accent.** JetBrains Mono for IDs, hashes, timestamps, commands — not body copy.
- **Don't regress data wiring.** Pages already speak to the API via `lib/*`; keep query hooks intact —
  this is a *presentation* upgrade.
- **Keep tests green.** Update co-located `*.test.tsx` when markup changes; don't delete coverage.
- **No new deps.** Everything composes from existing Radix/shadcn + the new primitives.
