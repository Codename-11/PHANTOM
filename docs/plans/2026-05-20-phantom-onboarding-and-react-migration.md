# PHANTOM Onboarding + Discovery + React Migration Plan

> **⚠ Superseded by `2026-05-20-phantom-mega-plan.md`.**
> This document remains as an implementation note for the React
> migration thread (now A8 in the mega-plan) and for the onboarding +
> discovery threads (now A1 and A1b). The mega-plan is the single
> canonical source of truth for ordering, dependencies, and goal
> invocations. Use it for `/goal follow …`.

> **For Hermes / Claude Code / Codex:** This plan has **three independent
> threads**. Threads 1 and 2 can run in parallel; thread 3 must wait until
> 1 and 2 land. Treat each thread's "Goal prompt" block as paste-ready
> input for a coding agent or `/goal` invocation. Every change must keep
> PHANTOM's existing tests green and obey CLAUDE.md commit rules.

**Background:** A fresh PHANTOM install today drops the operator on Dash
with no assets, no scopes, no installed toolpacks, and no clear next
action. The `welcome-features` grid is decorative, not actionable. The
existing `frontend/js/onboarding-wizard.js` only covers the model + sudo
handshake. A `scripts/seed.js` demo seeder exists in the working tree
but is untracked and has no UI affordance. The frontend is also entirely
hand-rolled CSS + vanilla JS; we want to stop maintaining a bespoke
component layer.

**Goal:** Make first run obvious, automate asset discovery for empty
inventories, and migrate the UI to React + Tailwind + shadcn/ui without
disturbing server/API state.

**Tech stack additions:**
- React 18, Vite 5, Tailwind CSS 3.4, shadcn/ui (CLI-scaffolded), React
  Query, Zustand, Vitest + React Testing Library, react-router-dom.
- No new server-side dependencies for threads 1 and 2.

---

## Concept

```text
Fresh install
  → Dash shows checklist with one obvious next action
  → Operator clicks: Load demo / Scan network / Install toolpacks
  → System self-populates → checklist clears → real work begins
```

The same surfaces are progressively re-implemented as React components
backed by shadcn/ui primitives so we delete `cf-chip-picker`,
`cf-segmented`, `cf-risk-grid`, `cf-prompt-preview`, `campaign-pill`,
`campaign-timeline`, and the drawer/overlay CSS in favor of standardized
ToggleGroup / Tabs / Checkbox / Badge / Sheet / Dialog.

## Non-Goals

- Do NOT auto-seed on first boot. The operator must explicitly opt in.
- Do NOT auto-confirm discovered hosts as real assets. They become drafts.
- Do NOT change route names, URLs, or API contracts during migration.
- Do NOT introduce a server framework rewrite or new database layer.
- Do NOT replace the canvas-based graph renderer; only its chrome migrates.

## Core Principles

1. **Empty state is a feature, not an absence.** Every list page must
   show an actionable empty state with a primary CTA.
2. **Discovery is opt-in.** Network reads — even passive ARP — require
   either an active scope authorizing recon or an explicit
   acknowledgement modal.
3. **Coexistence beats rewrites.** During thread 3, vanilla pages keep
   working until each route is fully ported. We flip pages over one at
   a time.
4. **Aesthetic survives the rewrite.** The cool-slate SEC palette
   (--cy-1 cyan, JetBrains Mono headers, calm dark backgrounds) is
   pixel-preserved; only the implementation changes.

---

## Thread Map

| Thread | Title                                       | Duration | Depends on |
|------- |---------------------------------------------|----------|------------|
| 1      | First-run path (checklist + demo seed)      | ½–1 day  | —          |
| 2      | Local network discovery tool                | 1 day    | thread 1's empty-state CTA on Assets page (soft dep — can land independently) |
| 3      | React + Tailwind + shadcn/ui migration      | 2–3 wks  | threads 1 & 2 |

Threads 1 and 2 can run in parallel. Thread 3 must wait so the React
port doesn't re-implement the discovery + onboarding flows mid-migration.

---

## Thread 1 — First-Run Path

**Objective:** Eliminate the "I opened PHANTOM and don't know what to
do" moment. A new operator should land on Dash and see a checklist with
one obvious next action, plus a one-click "Load demo scenario"
affordance.

**Recommended agent team:**
1. `Explore` — audit `scripts/seed.js`, `frontend/js/onboarding-wizard.js`,
   the `welcome-features` grid in `frontend/index.html`, and the empty
   states on Assets / Scope / Toolpacks. Report which already render
   empty-state CTAs vs. which silently show nothing.
2. `feature-dev:code-architect` — produce the blueprint.
3. `general-purpose` (or `claude`) — implement phase-by-phase.
4. `feature-dev:code-reviewer` — verify before merge.

### Files

Create:
- `server/onboarding/onboarding-status.js`
- `server/onboarding/onboarding-status.test.js`
- `server/onboarding/onboarding-routes.test.js` (or extend `routes/api.test.js`)

Modify:
- Track `scripts/seed.js` (currently untracked in the working tree)
- `package.json` — add `"seed": "node scripts/seed.js"` to scripts
- `server/routes/api.js` — mount onboarding routes
- `frontend/index.html` — replace `welcome-features` with onboarding checklist mount
- `frontend/js/pages/dash.js` or new `frontend/js/pages/onboarding-checklist.js`
- `frontend/js/onboarding-wizard.js` — add 3rd "Get started" step
- `frontend/css/styles.css` — checklist + structured empty-state styling
- Empty-state pass: each of `assets-page`, `scope-page`, `campaigns-page`,
  `runs-page`, `artifacts-page`, settings → toolpacks card

### API Shape

- `GET /api/onboarding/status` →
  ```json
  {
    "checklist": {
      "toolpacksInstalled": false,
      "hasAsset": false,
      "hasScope": false,
      "hasRun": false,
      "demoLoaded": false
    },
    "complete": false
  }
  ```
- `POST /api/onboarding/load-demo` — imports `scripts/seed.js` in-process
  via dynamic import (NOT child_process); returns the created
  `{ scopeIds, assetIds, runIds }`.
- `POST /api/onboarding/clear-demo` — invokes the seeder's `--reset` path
  in-process; returns count of rows removed.

### Implementation Tasks

#### Task 1.1 — Commit the seeder + add npm script

1. `git add scripts/seed.js`
2. Add `"seed": "node scripts/seed.js"` to `package.json` scripts.
3. Run `npm run seed` against a throwaway DB to confirm the script works.
4. Run `npm run seed -- --reset` to confirm cleanup works.
5. Commit: `chore: track demo seed script + npm run seed`.

#### Task 1.2 — Onboarding status module + routes

1. Write `server/onboarding/onboarding-status.test.js` first (TDD):
   - Fresh DB → all booleans false, `complete=false`.
   - Seed one toolpack install → `toolpacksInstalled=true`.
   - Seed one asset → `hasAsset=true`.
   - And so on for scope / run / demo tag.
2. Implement `getOnboardingChecklist()` in
   `server/onboarding/onboarding-status.js` by reading
   counts from existing stores (do NOT add new schema).
3. Add `loadDemo()` and `clearDemo()` that dynamic-import
   `scripts/seed.js` and invoke its exported functions. If the script
   has no exported entry, refactor minimally to expose
   `runSeed({ reset })`.
4. Wire `GET/POST/POST` routes in `server/routes/api.js`.
5. Commit: `feat: add onboarding status + demo seed endpoints`.

#### Task 1.3 — Dash onboarding checklist

1. Add `<section id="onboarding-checklist" class="onboarding-checklist" hidden>` to `#dash-page` before `#cockpit`.
2. New JS module `frontend/js/pages/onboarding-checklist.js`:
   - On Dash show, fetch `/api/onboarding/status`.
   - If `complete`, hide the section.
   - Otherwise render 5 rows, each a button. Unchecked rows show their
     primary CTA; checked rows show a muted green ✓.
3. CTAs:
   - Toolpacks → navigate to Settings, scroll to toolpacks card.
   - Add asset → navigate to Assets, scroll to new asset form.
   - Draft scope → navigate to Scope, open new scope editor.
   - Run starter campaign → open Campaigns + auto-open create overlay
     pre-filled with the demo objective.
   - Load demo scenario → POST `/api/onboarding/load-demo`, then reload.
4. Commit: `feat: dash onboarding checklist with load-demo affordance`.

#### Task 1.4 — Extend onboarding wizard

1. Add a 3rd step "Get started" after the model + sudo handshake.
2. Three buttons:
   - `[Load demo scenario]` → POST load-demo + close wizard + navigate Dash.
   - `[Scan my network for assets]` → navigate Assets (thread 2 wires
     the real action; for now show a placeholder banner explaining
     thread 2 will add this).
   - `[I'll set it up manually]` → close wizard + navigate Dash.
3. The wizard only opens when `onboarding/status.complete=false` AND
   the existing model/sudo gates have already passed.
4. Commit: `feat: extend onboarding wizard with get-started step`.

#### Task 1.5 — Empty-state pass

For each list page (Assets, Scope, Campaigns, Runs, Artifacts,
toolpacks card in Settings), replace the current "No X yet" text with a
structured empty state matching the campaign-empty pattern:
- Eyebrow line (mono uppercase)
- Title line
- 1–2 sentence help line
- Primary CTA button

Commit: `feat: structured empty states across list pages`.

### Acceptance Criteria

- Fresh DB → Dash shows checklist with 5 unchecked rows.
- Clicking "Load demo" → all 5 flip to checked, checklist auto-hides on
  next status fetch, demo runs/scopes/assets appear in their lists.
- "Clear demo" returns the system to fresh state.
- Onboarding wizard's "Get started" step is reachable.
- Empty Assets/Scope/Campaigns/Runs/Artifacts pages each show a CTA
  empty state.
- `npm test` passes; new tests cover `getOnboardingChecklist` + the
  three routes.

### Goal prompt (paste-ready for one-shot agent)

```markdown
You are implementing PHANTOM's first-run experience so a fresh install
(empty DB, no toolpacks, no scope, no assets) has a clear, governed
path to a working demo.

Objective:
Eliminate the "I opened PHANTOM and don't know what to do" moment. A
new operator should land on Dash and see a checklist with one obvious
next action, plus a one-click "Load demo scenario" affordance.

Authorized scope:
- Files in repo only. No docker / network actions.
- Add a new API endpoint that runs the existing seed script via an
  in-process dynamic import — NOT a shell-out.
- Do NOT auto-seed on first boot. Operator must opt in.

Concrete deliverables:
1. Commit scripts/seed.js as-is + add "seed" to package.json scripts.
2. server/onboarding/onboarding-status.js exposing
   getOnboardingChecklist() → 5 booleans.
3. GET /api/onboarding/status, POST /api/onboarding/load-demo,
   POST /api/onboarding/clear-demo.
4. Replace #dash-page welcome-features grid with a checklist that
   mounts when onboarding/status reports incomplete.
5. Extend frontend/js/onboarding-wizard.js with a 3rd "Get started"
   step (Load demo / Scan network / Manual).
6. Empty-state pass on Assets / Scope / Campaigns / Runs / Artifacts /
   toolpacks card — replace bare "No X yet" with structured states.

Operating rules:
- Stay in vanilla JS. React migration is thread 3.
- Do not change existing CSS tokens — reuse --cy-*, --fg-*, --line-*.
- Seed runs via dynamic import; refactor seed.js minimally if it
  doesn't export a runSeed({reset}) function.
- All new endpoints have route tests.

Acceptance criteria:
- Fresh DB → checklist visible with 5 rows; load-demo flips all to ✓.
- Clear-demo returns to fresh state.
- npm test passes (new tests for status + routes).
- Manual smoke: open / in browser on a fresh DB, see the checklist
  + onboarding wizard get-started step.

Deferred:
- "Scan network" button wires to thread 2.
- React port lands in thread 3.
```

### Deferred

- Per-page "what just happened?" inline tour after demo load.
- Telemetry on which CTA users click first.
- Multi-tenant onboarding (single-tenant assumption holds).

---

## Thread 2 — Local Network Discovery Tool

**Objective:** Add `phantom_discover_local_network` — a passive
ARP/neighbor-table read that enumerates the host's local subnet and
proposes the discovered IPs as DRAFT assets the operator confirms.

**Recommended agent team:**
1. `Explore` — confirm where toolpack tools register
   (`server/tools/`), how `phantom_*` tools dispatch, how policy gates
   current discovery actions.
2. `general-purpose` (or `codex:codex-rescue` if a tool path is stuck)
   — implement.
3. `feature-dev:code-reviewer` — verify the policy gate cannot be
   bypassed and that no active probing slipped in.

### Files

Create:
- `server/tools/network-discovery.js`
- `server/tools/network-discovery.test.js`
- `server/routes/discover-routes.test.js` (or extend `routes/api.test.js`)

Modify:
- `server/tools/phantom-tools.js` — register `phantom_discover_local_network`
- `server/routes/api.js` — mount `/api/discover/*` routes
- `server/scope/policy.js` (only if needed to thread the recon class
  through correctly)
- `frontend/index.html` — review modal markup
- `frontend/js/pages/assets-page.js` — wire the [Scan this machine's
  network] button added in thread 1
- `frontend/css/styles.css` — modal styling if needed (reuse
  `.campaign-create-overlay` pattern where possible)

### API Shape

- `POST /api/discover/local-network` →
  ```json
  {
    "neighbors": [
      { "ip": "192.168.1.10", "mac": "aa:bb:cc:dd:ee:ff",
        "interface": "eth0", "hostname": null, "vendor": null }
    ],
    "count": 12,
    "platform": "linux",
    "artifactId": "<id of network-neighbors.json>"
  }
  ```
- `POST /api/discover/local-network/promote` body
  `{ items: [{ ip, mac?, hostname? }] }` → `{ created: [assetIds], skipped: [ips] }`.

### Implementation Tasks

#### Task 2.1 — Cross-platform parser

1. Write `network-discovery.test.js` first with fixtures from
   `arp -a` (Windows), `ip neigh show` (Linux), `arp -an` (macOS).
2. Implement `discoverLocalNetwork()` in
   `server/tools/network-discovery.js`:
   - Pick command + parser by `os.platform()`.
   - Spawn via `child_process.execFile` with a 3s timeout.
   - Cache results for 60s keyed by interface set.
   - Return `[{ ip, mac, hostname?, vendor?, interface }]`.
3. Commit: `feat: cross-platform local network discovery parser`.

#### Task 2.2 — Tool registration + policy gate

1. Register `phantom_discover_local_network` in
   `server/tools/phantom-tools.js`.
2. Tool returns a markdown table AND a structured array.
3. Policy gate: classify as `recon`. If the active scope (when present)
   denies recon, refuse with the standard blocked-event trace shape.
   When no scope is active, the API caller (the frontend modal) is
   responsible for the acknowledgement step — the tool itself just
   records `metadata.acknowledgedNoScope=true` in the trace event.
4. Write artifact `network-neighbors.json` with the structured array.
   Trace event includes only the COUNT, not the IPs.
5. Commit: `feat: phantom_discover_local_network tool + policy gating`.

#### Task 2.3 — API routes

1. `POST /api/discover/local-network` — gated on the same policy as
   the tool. Returns the result + the artifact id.
2. `POST /api/discover/local-network/promote` — creates draft assets
   with `metadata.discoveredFrom='local-network-scan'`. Idempotent: if
   an asset with the same IP already exists, skip it (return in
   `skipped`).
3. Tests: rejection path, promotion path, duplicate idempotence.
4. Commit: `feat: expose local discovery + asset promotion api`.

#### Task 2.4 — Assets page review modal

1. The empty-state CTA on Assets page (added in thread 1) gains a
   `[Scan this machine's network]` button.
2. Clicking it shows an acknowledgement modal if no active scope
   ("ARP reads can be visible to network monitoring; continue?").
3. After acknowledgement, POST `/api/discover/local-network`, render
   the result as a checkbox list with select-all.
4. "Promote to assets" calls the promote endpoint, closes the modal,
   reloads the asset list.
5. Commit: `feat: assets page network discovery modal`.

### Acceptance Criteria

- Tool returns a structured list + markdown table.
- Artifact `network-neighbors.json` written for every invocation.
- Policy gate rejects when recon is denied; trace event recorded with
  `risk=recon`, `decision=blocked`.
- Promote endpoint creates draft assets tagged
  `metadata.discoveredFrom='local-network-scan'`; duplicates are
  skipped not errored.
- Tests cover Linux + macOS + Windows parsers (with fixtures).
- Manual smoke: fresh install + thread 1 + this thread → operator
  clicks Scan, sees their LAN, confirms 2 hosts, lands on Assets page
  with the new draft assets.

### Goal prompt (paste-ready)

```markdown
You are adding a privilege-gated local-network discovery tool to
PHANTOM so an operator with an empty asset inventory can populate it
in one click instead of typing hosts by hand.

Objective:
Add phantom_discover_local_network — a passive ARP/neighbor-table read
that enumerates the host's local subnet and proposes the discovered
IPs as DRAFT assets the operator confirms before they become real.

Non-goals:
- No active probing (no packets sent). ARP/neigh reads only.
- No auto-confirm. Every result is a draft awaiting operator approval.

Authorized risk class: recon (passive). Hard-block when recon is denied
by the active scope. When no scope is active, require an explicit
acknowledgement step at the API caller (the frontend modal); the tool
records that acknowledgement in its trace event metadata.

Implementation:
1. server/tools/network-discovery.js — cross-platform parser for
   arp -a / ip neigh show / arp -an with a 60s cache and 3s timeout.
2. Register phantom_discover_local_network in phantom-tools.js;
   policy classify as recon; emit a tool.call.completed trace with
   COUNT only (not IPs). Write artifact network-neighbors.json.
3. POST /api/discover/local-network and
   POST /api/discover/local-network/promote routes.
4. Assets page empty-state gets [Scan this machine's network]; review
   modal with checkbox list → promote.

Tests:
- Mock child_process.execFile for each platform parser.
- Policy gate rejection when recon is denied.
- Duplicate-promote idempotence.

Acceptance:
- Fresh install + thread 1 + this thread → operator clicks Scan,
  reviews their LAN, confirms a subset, lands on Assets with new
  draft assets tagged metadata.discoveredFrom='local-network-scan'.
- Tool refuses cleanly when policy denies.

Deferred:
- mDNS / NetBIOS hostname enrichment.
- Active probing (separate tool).
- Cross-subnet discovery via routing-table walk.
```

### Deferred

- mDNS / NetBIOS hostname enrichment.
- Active probing (separate, more-gated tool).
- Cross-subnet discovery via routing-table walk.
- IPv6 neighbor discovery.

---

## Thread 3 — React + Tailwind + shadcn/ui Migration

**Objective:** Replace bespoke components (chip-picker, segmented,
drawer, modal, form fields, pills, kpi tiles, timeline) with shadcn/ui
primitives so we stop maintaining our own component layer. Preserve
the cool-slate SEC look — only the implementation changes, not the
aesthetic.

**Recommended agent team:**
1. `Plan` — produce the migration plan + phase order.
2. `Explore` (parallel with Plan) — inventory every hand-rolled
   component in `frontend/css/styles.css` and map each to its
   shadcn/ui equivalent.
3. `feature-dev:code-architect` — design the React skeleton + Vite +
   Tailwind config + coexistence strategy.
4. `general-purpose` (or `claude`) — implement phase-by-phase.
5. `feature-dev:code-reviewer` — verify each phase before the next.

### Stack

- React 18 + Vite 5 (Vite likely already present; add if not).
- Tailwind CSS 3.4 with a custom theme extending the SEC tokens
  (`--cy-1`, `--bg-0`, …) so the palette is identical.
- shadcn/ui CLI-scaffolded into `frontend/src/components/ui/`.
- React Query for `/api` calls (cache + refetch on mutate).
- Zustand for cross-page state (operator override, current scope, etc.).
- react-router-dom; keep the existing `data-route` attribute so
  vanilla pages still work during the transition.

### Files

Create (Phase 0):
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/routes.tsx`
- `frontend/src/lib/api.ts` (typed fetch wrapper)
- `frontend/src/lib/queryClient.ts`
- `frontend/src/components/ui/` (shadcn/ui primitives committed per
  shadcn/ui convention — we own the source)
- `frontend/src/styles/globals.css` (Tailwind directives + theme)
- `tailwind.config.ts`, `vite.config.ts` (if not present)
- `tsconfig.json` for the frontend

Modify:
- `package.json` — add React/Vite/Tailwind deps; new scripts:
  `dev:react`, `build:react`, `test:frontend` (Vitest)
- `server/index.js` — route flag for vanilla vs React pages
- `frontend/index.html` (legacy bundle) coexists; new entry
  `frontend/index-react.html` for the React app

Delete (Phase 5):
- Migrated vanilla modules + their CSS sections (`cf-*`, `campaign-*`,
  `goals-*`, etc.)

### Token Mapping (`tailwind.config.ts`)

```ts
theme: {
  extend: {
    colors: {
      background: 'var(--bg-0)',
      foreground: 'var(--fg-1)',
      card: 'var(--bg-2)',
      'card-foreground': 'var(--fg-1)',
      muted: 'var(--bg-3)',
      'muted-foreground': 'var(--fg-3)',
      border: 'var(--line-1)',
      primary: 'var(--cy-1)',
      'primary-foreground': 'var(--bg-0)',
      destructive: 'var(--danger)',
      ring: 'var(--cy-1)',
    },
    fontFamily: {
      mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'monospace'],
      sans: ['Inter', 'system-ui', 'sans-serif'],
    },
  },
}
```

### Phase Plan

#### Phase 0 — Infrastructure (no UI change)

- Add React + Vite + Tailwind + shadcn/ui to the build.
- Configure Tailwind to consume the existing CSS variables so colors
  match pixel-for-pixel.
- `frontend/src/` houses the React app; build output goes to
  `dist/react/` and `dist/legacy/`.
- Route flag in `server/index.js`: a `REACT_PAGES` set lists which
  routes the React app serves; everything else still serves the legacy
  bundle.
- **Acceptance:** `npm run build` produces both bundles; existing
  vanilla site unchanged; `REACT_PAGES` empty = nothing flipped over.

#### Phase 1 — Migrate Campaigns

Highest leverage because the hand-rolled `cf-*` + `campaign-*` kit was
just shipped and has the most bespoke components.

- Port Campaigns list + detail drawer + creation form to React.
- Replace `cf-chip-picker` → `ToggleGroup` (multi).
- Replace `cf-segmented` → `ToggleGroup` (single) or `Tabs`.
- Replace `cf-risk-grid` → `Checkbox` grid with `Badge` severity ticks.
- Replace `campaign-pill` → `Badge` with variants.
- Replace drawer → `Sheet`.
- Replace create overlay → `Dialog`.
- Replace `cf-prompt-preview` → `<pre>` inside `Card`.
- Live preview via React state; no manual rerender plumbing.
- React Query owns campaign list + replay queries; lifecycle actions
  invalidate via mutation `onSuccess`.
- **Acceptance:** every flow exercised in the latest campaign tests
  works end-to-end; visual parity within 1px; existing
  `campaign-presenter.test.js` + `campaign-form.test.js` REMAIN green
  while we add Vitest equivalents.

#### Phase 2 — Migrate Settings + Scope builder

- Settings tabs → `Tabs`.
- Toolpack install rows → `Accordion` + `Button` + `Badge`.
- Scope action matrix → `RadioGroup` per row.
- Risk + ROE selectors → `Select` + `Textarea`.
- Goals card (from earlier work) → `Form` + shadcn equivalents.

#### Phase 3 — Migrate Runs + Graph + Artifacts

- Run detail tabs → `Tabs`.
- Run meta drawer → `Sheet`.
- Graph page stays canvas-based; only its chrome migrates.
- Artifacts list → `DataTable` (shadcn/ui table + tanstack-table).

#### Phase 4 — Migrate Dash + Onboarding

Depends on thread 1.

- Cockpit panels → `Card`.
- Onboarding checklist → `Checkbox` list + `Button`.
- Load demo / scan network buttons → `Button` + `Dialog`.

#### Phase 5 — Cleanup

- Delete the vanilla bundle from the build.
- Delete `frontend/js/` modules that have been ported.
- Remove the `cf-*`, `campaign-*`, `goals-*` sections from
  `styles.css` now that shadcn/ui owns them.

### Acceptance Criteria

- All routed pages migrated.
- `sec-ui-kit.test.js` is REWRITTEN against the React bundle but its
  assertions on cool-slate tokens + no-green-accent rules survive
  verbatim — that's the regression bar.
- `frontend/css/styles.css` shrinks by at least 40% (~7100 → <4200
  lines including theme + tokens).
- Total JS bundle size does not regress by more than 25% — verify via
  `npm run analyze` before/after each phase.
- `npm test` (server) AND `npm run test:frontend` (Vitest) both green
  at every phase boundary.

### Goal prompt (paste-ready)

```markdown
You are migrating PHANTOM's frontend from vanilla JS + hand-rolled CSS
to React + Tailwind + shadcn/ui. The migration is gradual — the new
React app coexists with the existing vanilla pages until every route
is ported.

Objective:
Replace bespoke components with shadcn/ui primitives so we stop
maintaining our own component layer. Preserve the cool-slate SEC look
(cy-1 cyan, JetBrains Mono headers, calm dark backgrounds) — only the
implementation changes.

Non-goals:
- No server / API rewrite.
- No route name or URL changes.
- No replacement of the canvas-based graph renderer.
- No new state library beyond React Query + Zustand.

Stack:
- React 18, Vite 5, Tailwind 3.4, shadcn/ui (CLI scaffolded into
  frontend/src/components/ui).
- React Query for fetches, Zustand for cross-page state,
  react-router-dom.
- Vitest + Testing Library for new tests; node:test for server tests.

Phase 0 — infrastructure:
- Add deps + scripts (dev:react, build:react, test:frontend).
- tailwind.config.ts maps theme.colors to the existing --cy-* / --fg-*
  / --line-* variables so the palette is identical.
- Build produces dist/legacy/ + dist/react/.
- server/index.js gets a REACT_PAGES set; empty by default = nothing
  flipped over. Existing site unchanged.

Phase 1 — Campaigns (start here once Phase 0 lands).
Phase 2 — Settings + Scope.
Phase 3 — Runs + Graph + Artifacts.
Phase 4 — Dash + Onboarding (depends on thread 1).
Phase 5 — Cleanup; delete migrated vanilla modules + their CSS sections.

Token mapping in tailwind.config.ts:
  background    : var(--bg-0)
  foreground    : var(--fg-1)
  card          : var(--bg-2)
  card-foreground: var(--fg-1)
  border        : var(--line-1)
  primary       : var(--cy-1)
  primary-foreground: var(--bg-0)
  muted         : var(--bg-3)
  muted-foreground: var(--fg-3)
  destructive   : var(--danger)
  ring          : var(--cy-1)

Component mapping (Phase 1):
  cf-chip-picker  → ToggleGroup (multi)
  cf-segmented    → ToggleGroup (single) or Tabs
  cf-risk-grid    → Checkbox grid with Badge severity ticks
  campaign-pill   → Badge variants
  drawer          → Sheet
  create overlay  → Dialog
  cf-prompt-preview → <pre> inside Card

Operating rules:
- Each phase is its own commit / PR.
- sec-ui-kit.test.js is REWRITTEN against the React bundle; its
  cool-slate token assertions are the regression bar.
- Run npm test + npm run test:frontend at every phase boundary.
- Commit shadcn/ui primitives into frontend/src/components/ui/ per the
  library's convention (we own the source).

Acceptance:
- All pages migrated; visual parity within 1px per page.
- styles.css ≤ 4200 lines after cleanup.
- Bundle size regression ≤ 25%.
- All server tests + new Vitest tests green.

Deferred:
- Storybook (recommend Ladle for Vite-native, post-cleanup).
- React Server Components / Next.js — not needed for single-tenant.
- Replacing the canvas-based graph renderer.
```

### Deferred

- Storybook / Ladle.
- React Server Components / Next.js.
- Canvas-based graph renderer replacement.
- Mobile-responsive variant (current target is desktop ops cockpit).

---

## Verification Pipeline

Run before claiming any thread complete:

```bash
cd ~/projects/PHANTOM
npm test
npm run build
find server frontend/js -name '*.js' -not -path '*node_modules*' -print0 \
  | xargs -0 -n1 node --check
python3 tests/smoke_test.py
python3 tests/graph_viewer_smoke.py
git diff --check
```

After thread 3 Phase 0:

```bash
npm run test:frontend
npm run build:react
```

---

## Cross-Thread Notes

- Threads 1 and 2 share the Assets page empty-state CTA. Land thread
  1 first; thread 2 wires the "Scan network" button to the real
  action.
- Thread 3 Phase 4 depends on thread 1's onboarding checklist
  existing. Don't start Phase 4 until thread 1 is merged.
- If thread 3 starts BEFORE thread 1 ships, Phase 4 is skipped until
  thread 1 lands; phases 1–3 + 5 are independent.

## Acceptance Criteria (whole plan)

- A fresh install lands on Dash with an obvious next action.
- Empty Asset inventory can be populated via a one-click LAN scan
  without typing hosts.
- The hand-rolled component layer in `frontend/css/styles.css` is gone
  in favor of shadcn/ui; styles.css ≤ 4200 lines.
- Cool-slate SEC aesthetic is preserved pixel-for-pixel.
- All existing security / governance gates remain enforced.

## Deferred (whole plan)

- Telemetry on onboarding completion / drop-off.
- mDNS + active probing variants of discovery.
- Mobile-responsive variant of the cockpit.
- Storybook for the new component library.
- Inline tour overlays after demo load.
