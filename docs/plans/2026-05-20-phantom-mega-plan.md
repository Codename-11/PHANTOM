# PHANTOM Mega-Plan — Final Product Polish + Governed Registry

> **Single source of truth.** This plan supersedes
> `2026-05-20-phantom-onboarding-and-react-migration.md` (now an
> implementation note for thread A8 within this document). It synthesizes
> the Hermes audit + the onboarding/React migration plan into one
> ordered execution graph that an agent team can follow with a single
> `/goal follow <path>` invocation.

Date: 2026-05-20
Repo: `C:\Users\Bailey\Desktop\Open-Projects\PHANTOM` (dev) ·
`~/projects/PHANTOM` (docker-server).

## Provenance / Source artifacts

This plan synthesizes (do not re-execute these; treat as background):

- Implementation state audit: `/home/bailey/.hermes/kanban/workspaces/t_78e4a628/phantom-state-audit.md`
- UI/UX polish spec: `/home/bailey/.hermes/kanban/workspaces/t_995fd317/phantom-ui-ux-polish-spec.md`
- Governed hosted registry architecture: `/home/bailey/.hermes/kanban/workspaces/t_b62669a7/governed-hosted-toolpack-registry-architecture.md`
- Product completion roadmap: `/home/bailey/.hermes/kanban/workspaces/t_8ce4e254/phantom-product-completion-roadmap.md`
- Final product polish + registry plan: `/home/bailey/.hermes/kanban/workspaces/t_1c6737ef/phantom-final-product-polish-registry-plan.md`
- Goal engine plan: `docs/plans/2026-05-20-phantom-goal-engine-plan.md` (done)
- Goal prompt templates: `docs/plans/2026-05-20-phantom-goal-prompt.md`
- Onboarding + React migration plan: `docs/plans/2026-05-20-phantom-onboarding-and-react-migration.md` (folded into this doc)

## Executive recommendation

PHANTOM already has the foundation of a governed local-first
security-ops cockpit: runs, traces, artifacts, scopes, findings, the
campaign engine, policy gates, curated toolpacks, installer approvals,
docs, tests, Docker packaging. The remaining gap is **productization,
not core architecture**.

The fastest credible route to a polished final product:

1. **Stabilize and explain the existing surface** — diagnostics, bounded
   route failures, first-run guidance, runtime/deployment clarity.
2. **Make Campaigns the flagship workflow** (already done in the prior
   feat: `c7ef928`).
3. **Make governance visible** — plain-language approval reasons,
   policy/risk badges, blocked-action explanations, audit timelines.
4. **Build the registry from the inside out** — first unify built-in
   toolpacks + installer catalog + profiles + Docker-profile metadata
   into local signed/validated manifests; only then add a private
   hosted registry.
5. **Defer public/ecosystem registry** until local verification,
   version pinning, rollback, approvals, revocation, audit logs, and
   incident runbooks are proven.

**Do not build a plugin marketplace first.** PHANTOM's security
posture depends on treating toolpacks as signed, reviewed metadata
contracts that local PHANTOM verifies and governs before any install
or execution.

## Workstream Map

Two workstreams run in parallel where dependencies allow.

```text
Workstream A — Polish + operator readiness
  A0 Diagnostics/readiness  ────────┐
  A1 First-run path                  │
  A1b Local network discovery        │ (independent; can fan out)
  A2 Campaign UI MVP                 │ DONE — c7ef928
  A3 Approval explainability         │
  A4 Evidence/replay surfaces        │
  A5 Dashboard IA + next-action      │
  A6 Settings consolidation          │
  A7 Alerts → incidents              │
  A8 React+Tailwind+shadcn migration │  ← substrate for A9
  A9 Responsive + accessibility      │  ← folded into A8 phases
  A10 Terminology / docs / demo      │

Workstream B — Governed toolpack registry
  B0 Manifest schema spike          ──┐ (can start in parallel with A0–A3)
  B1 Local registry client + catalog │
  B2 Registry UI + local import MVP  │   ← unlocks once B1 + A3 ship
  B3 Private hosted signed registry  │
  B4 Governance hardening            │
  B5 Public read path                │
```

Dependency edges:

- A0 unblocks every later A phase (diagnostics endpoint is reused).
- A1 unblocks A1b (Assets empty-state CTA wires to the scan tool).
- A2 ships before A3/A4 (already done — c7ef928).
- A8 (React migration) is gated on A1 + A1b + A2 + A3 + A4 + A5 being
  feature-complete in vanilla so the rewrite has a stable target.
- A9 is implemented incrementally within A8 phases (each ported route
  gets responsive + a11y at port time).
- B1 depends on B0 (schema exists before code consumes it).
- B2 depends on B1 + A3 (approvals can render registry events).
- B3 depends on B2.
- B4 depends on B3.
- B5 depends on B4.

---

# Workstream A — UI/UX Polish + Operator Readiness

## A0 — Diagnostics / Readiness

**Objective:** Operator can see Ready / Needs setup / Degraded / Blocked
state for the runtime, provider, docs, toolpacks, DB, and workspace
without dropping to curl or devtools.

**Agent team:** `Explore` → `feature-dev:code-architect` →
`general-purpose` → `feature-dev:code-reviewer`.

### Files

- Create: `server/diagnostics/diagnostics.js`, `diagnostics.test.js`
- Modify: `server/routes/api.js`, `frontend/index.html` (Dash + Settings
  cards), `frontend/js/pages/dash.js` (or new `dash-diagnostics.js`),
  `frontend/css/styles.css`

### API Shape

```json
GET /api/diagnostics → {
  "runtime": { "mode": "docker|native", "elevation": "root|sudo|admin|user", "platform": "linux|win32|darwin" },
  "db":      { "status": "ok|degraded|blocked", "path": "...", "writable": true },
  "workspace": { "status": "ok|degraded", "path": "..." },
  "provider": { "status": "ok|misconfigured|unreachable", "id": "hermes", "reachable": true },
  "docs":    { "status": "ok|missing|disabled" },
  "toolpacks": { "installedCount": 0, "totalCount": 0, "availableCount": 0 },
  "campaigns": { "activeCount": 0, "draftCount": 0 },
  "checks": [
    { "id": "db", "status": "ok", "elapsedMs": 4 },
    ...
  ],
  "overall": "ready|needs_setup|degraded|blocked",
  "generatedAt": "2026-05-20T...Z"
}
```

Every check has its own timeout (≤500ms each); the route returns within
1500ms total even if all checks fail. Secrets MUST be redacted (api key
preview is `••••<last4>`).

### Tasks

1. Implement check functions with individual timeouts (`Promise.race`
   each); each returns `{status, elapsedMs, detail?}`.
2. Aggregate into `overall` per the worst component status.
3. Frontend: Dash gets a `diagnostics-card` with traffic-light dot per
   component; Settings → Diagnostics gets a full panel with retry +
   "copy as JSON" affordance.
4. Tests: redaction, timeout, status aggregation, deny secret leaks.

### Acceptance

- `/api/diagnostics` returns in <1500ms with one check timing out.
- No secret values appear in any response field or detail string.
- Fresh install renders the readiness card on Dash with mostly-degraded
  state and a "Set up PHANTOM" CTA pointing at the onboarding wizard.

### Goal prompt

```markdown
Add a redacted, bounded diagnostics endpoint and surface it on Dash +
Settings. Each check has a ≤500ms timeout; the route returns in
≤1500ms total. Redact secrets (api key as ••••last4). Overall status is
ready|needs_setup|degraded|blocked. Frontend: Dash diagnostics card +
Settings → Diagnostics page with retry + copy-as-JSON.

Tests: timeout per check, secret redaction, status aggregation, route
returns even when every check fails.

Files: server/diagnostics/diagnostics.js (+test), routes/api.js,
frontend Dash/Settings, css.

Acceptance: fresh install shows a Dash card + a "Set up PHANTOM" CTA.
No primary page hangs when a check fails.

Deferred: provider rate-limit probe (separate task), websocket
diagnostics (the existing topbar dot already covers connection state).
```

---

## A1 — Guided First-Run Path + Empty States

**Objective:** Eliminate the "I opened PHANTOM and don't know what to
do" moment. Operator sees a checklist on Dash + an extended onboarding
wizard.

Previously documented as Thread 1 in
`2026-05-20-phantom-onboarding-and-react-migration.md`. Promoted to A1
here; see that document for the full task breakdown.

**Agent team:** same as A0.

### Files

- Track: `scripts/seed.js`; add `npm run seed` to `package.json`.
- Create: `server/onboarding/onboarding-status.js` + test.
- Modify: `server/routes/api.js`, `frontend/index.html`,
  `frontend/js/onboarding-wizard.js`, `frontend/js/pages/dash.js` (new
  checklist module), empty-state pass on Assets / Scope / Campaigns /
  Runs / Artifacts / Toolpacks card.

### API Shape

- `GET /api/onboarding/status` → `{ checklist:{toolpacksInstalled, hasAsset, hasScope, hasRun, demoLoaded}, complete }`
- `POST /api/onboarding/load-demo` → invokes seed via dynamic import
- `POST /api/onboarding/clear-demo` → invokes seed `--reset`

### Goal prompt

```markdown
Eliminate the empty-workspace dead end. Dash mounts an onboarding
checklist that flips ✓ as the operator sets up each piece. Onboarding
wizard gains a 3rd "Get started" step (Load demo / Scan network /
Manual). Every list page gets a structured empty state with a primary
CTA.

Seed runs via in-process dynamic import — NOT a child process — so it
works in Docker without `node` on the spawn PATH. Refactor scripts/
seed.js minimally to expose runSeed({reset}) if needed.

Files: server/onboarding/onboarding-status.js (+test+route test),
scripts/seed.js (track + minimal refactor), routes/api.js,
frontend/index.html, onboarding-wizard.js, new
pages/onboarding-checklist.js, empty-state pass on assets/scope/
campaigns/runs/artifacts/toolpacks card.

Acceptance: fresh DB → 5-row unchecked checklist; load-demo flips
all ✓; clear-demo returns to fresh; wizard's get-started step is
reachable; no list page shows a bare "No X yet" anymore.

Stay in vanilla JS — React migration is A8.
```

---

## A1b — Local Network Discovery Tool

**Objective:** Operator can populate an empty asset inventory in one
click via a passive ARP/neighbor-table read.

Previously documented as Thread 2 in
`2026-05-20-phantom-onboarding-and-react-migration.md`. Promoted to A1b
since it wires into the A1 Assets empty-state CTA.

**Agent team:** `Explore` → `general-purpose` →
`feature-dev:code-reviewer`. Use `codex:codex-rescue` only if stuck on
the cross-platform parser.

### Files

- Create: `server/tools/network-discovery.js` + test,
  `server/routes/discover-routes.test.js`.
- Modify: `server/tools/phantom-tools.js`, `server/routes/api.js`,
  `frontend/js/pages/assets-page.js`, `frontend/index.html` (review
  modal), `frontend/css/styles.css`.

### API Shape

- `POST /api/discover/local-network` → `{ neighbors: [...], count, platform, artifactId }`
- `POST /api/discover/local-network/promote` body `{ items: [{ip, mac?, hostname?}] }` → `{ created, skipped }`

### Goal prompt

```markdown
Add phantom_discover_local_network — passive ARP/neighbor-table read
that proposes discovered IPs as DRAFT assets the operator confirms.

No active probing. No auto-confirm. Risk class = recon; hard-block when
recon is denied. When no scope is active, require an acknowledgement
step at the API caller; the tool records that ack in its trace event.

Files: server/tools/network-discovery.js (+test), phantom-tools.js
(register), routes/api.js (mount), assets-page.js (modal),
frontend/index.html (modal markup), styles.css.

Cross-platform parsers: arp -a (Win), ip neigh show (Linux), arp -an
(macOS). 60s result cache. 3s spawn timeout. Trace event records COUNT
only (not IPs); artifact network-neighbors.json contains the
structured list. Promote endpoint is idempotent (skip if asset.ip
already exists).

Tests: each platform parser with fixtures (mock execFile), policy
gate rejection, promote idempotence.

Acceptance: empty Assets page → [Scan this machine's network] →
acknowledgement modal (if no scope) → review modal with checkboxes →
promote selected → land on Assets with new drafts tagged
metadata.discoveredFrom='local-network-scan'.

Deferred: mDNS/NetBIOS enrichment, active probing, cross-subnet,
IPv6 neighbors.
```

---

## A2 — Campaign UI MVP

**Status: SHIPPED in commit `c7ef928`.** Documented for completeness.

Creation drawer, detail Sheet-equivalent with Overview/Goals/Runs/
Evidence tabs, lifecycle buttons (start/pause/resume/cancel/run-next),
report + evidence-bundle exports. See `feat: campaign creation form +
replay/evidence bundle + codex-exec backend` commit body for the full
inventory.

Remaining nice-to-haves now folded into A3 (approval clarity for
needs_approval campaigns) and A4 (Evidence tab depth).

---

## A3 — Approval Explainability

**Objective:** Operator can approve/deny without reading raw JSON.
Cards show target, risk class, action class, policy reason, expected
effect, side effects, raw details disclosure, and the approve/deny
choice — including for future registry imports.

**Agent team:** `Explore` → `feature-dev:code-architect` →
`general-purpose` → `feature-dev:code-reviewer`.

### Files

- Modify: `frontend/js/pages/approvals-page.js`, trace/approval
  serialization helpers under `server/scope/` and `server/tools/`, the
  installer request display, `frontend/css/styles.css`.
- Create: `server/approvals/explain.js` (pure formatter from a raw
  approval record → a human-readable explainable shape).

### API Shape

```json
GET /api/approvals → [
  {
    "id": "...", "type": "scope|install|registry|elevated",
    "target": "host.com / asset:abc / package:web-recon@1.0.0",
    "riskClass": "recon",
    "actionClass": "tool.web_request",
    "policyReason": "online-bruteforce is in blocked_actions for scope X",
    "expectedEffect": "Sends 1 HTTP GET to host.com",
    "sideEffects": ["Writes 1 trace event", "May leave a log entry on host.com"],
    "rawDetails": "<JSON disclosure>",
    "createdAt": "...", "status": "pending|approved|denied"
  }
]
```

### Tasks

1. Add `explain(approval)` formatter that knows how to render scope,
   install, registry, and elevated-command approval shapes into the
   structured fields above.
2. Update approvals page presenter to use the new fields; add a
   collapsed "Raw details" `<details>` block for the JSON disclosure.
3. Denial requires a note when risk class is `high|crit`. Persist
   `denial_reason` on the approval record.
4. Stale / resolved approvals have their controls disabled and labeled.

### Acceptance

- Approve / deny works without expanding the raw JSON for routine
  cases.
- High/crit denials require a note before submission.
- Decision history shows actor + reason + before/after.

### Goal prompt

```markdown
Make approvals explainable. Add server/approvals/explain.js (pure
formatter) that turns a raw approval record into the structured
{target, riskClass, actionClass, policyReason, expectedEffect,
sideEffects, rawDetails} shape. Render it on the approvals page with a
collapsed "Raw details" <details> block. High/crit denials require a
note (persisted as denial_reason). Stale/resolved approvals have
disabled controls.

Files: server/approvals/explain.js (+test), routes/api.js (return the
explained shape), frontend/js/pages/approvals-page.js (presenter
update), styles.

Acceptance: routine approval cards are readable without expanding raw
JSON; high/crit denial requires a note; decision history is durable.

Deferred: ML-suggested reasons, batch-approve.
```

---

## A4 — Evidence / Replay Surfaces

**Objective:** Runs / Graph / Artifacts / Synthesis feel like one
investigation timeline. Each run + each campaign has an Evidence tab
that aggregates artifacts, trace export, graph snapshot, findings,
synthesis, approvals, scope/prompt/config snapshots, notes, and
Markdown/JSON export.

**Agent team:** `Explore` → `feature-dev:code-architect` →
`general-purpose` → `feature-dev:code-reviewer`.

### Files

- Create: `server/evidence/evidence-builder.js` + test,
  `server/evidence/evidence-redactor.js` + test.
- Modify: `frontend/js/pages/runs-page.js` (Evidence tab),
  campaign detail Evidence pane (already exists; deepen it),
  `server/routes/api.js` (evidence routes), `frontend/css/styles.css`.

### API Shape

- `GET /api/runs/:id/evidence` → aggregated JSON.
- `POST /api/runs/:id/evidence/export` body `{ format: 'markdown'|'json' }` → creates an artifact.
- Campaign equivalents already exist (the `c7ef928` work added them);
  this phase deepens what they contain (snapshots, redaction).

### Tasks

1. Define the evidence shape (already partially codified by the
   campaign replay roll-up — extend it with prompt snapshot, scope
   snapshot, config snapshot, operator notes).
2. Redaction pass: every export goes through `evidence-redactor` which
   strips api keys, sudo passwords, anything matching the existing
   secret-redaction regex set.
3. UI: a single Evidence tab per run + per campaign with the same
   visual language (kpi tiles + timeline + per-section accordions).

### Acceptance

- Markdown export of a run contains no secret values.
- Evidence tab is the same on run + campaign surfaces (consistent IA).
- Notes are persistent and live on the run/campaign record.

### Goal prompt

```markdown
Unify the investigation timeline. Each run + campaign gets an Evidence
tab that aggregates artifacts, trace export, graph snapshot, findings,
synthesis, approvals, scope/prompt/config snapshots, notes, and a
single Markdown/JSON export action.

Files: server/evidence/evidence-builder.js (+test), evidence-redactor.js
(+test), routes/api.js (mount /api/runs/:id/evidence GET + POST export),
frontend runs-page Evidence tab, deepen the campaign Evidence pane,
styles.

Redaction is mandatory before any artifact write: api keys, sudo
passwords, anything matching the existing redact set. Add fuzz tests
for the redactor against synthesized secret-bearing trace rows.

Acceptance: Markdown export of a run with seeded api-key in stdout
contains ••••last4, never the raw key. Evidence tab IA matches between
runs + campaigns.

Deferred: external publish/share, evidence diffing between runs.
```

---

## A5 — Dashboard IA + Next-Action Affordance

**Objective:** Dash is next-action-first, not metric-first. The
operator always sees one obvious primary action.

**Agent team:** `Explore` → `feature-dev:code-architect` →
`general-purpose` → `feature-dev:code-reviewer`.

### Files

- Modify: `frontend/index.html` (Dash shell), `frontend/js/pages/dash.js`,
  `frontend/js/router.js`, `frontend/css/styles.css`.

### Tasks

1. Replace the "Overview · Dash" header with "Operations Command
   Center" (or keep "Dash"; decide via the Open Decisions section).
2. Top of page: a single hero card showing the current primary action,
   derived from the diagnostics + onboarding + campaign state:
   - readiness blocked → "Fix [item]"
   - onboarding incomplete → "Continue setup"
   - active campaign → "Continue [campaign name]"
   - pending approvals → "Review [N] approvals"
   - else → "Start a new campaign" / "Run a quick chat"
3. Move the existing KPI strip + panels below the hero card.
4. Add a "Continue where you left off" pill that opens the last
   conversation / run / campaign.

### Acceptance

- Dash always exposes exactly one primary CTA at the top.
- The CTA target updates when the underlying state changes (poll on
  page-show + after every mutation).

### Goal prompt

```markdown
Make Dash next-action-first. Top of page: a single hero card with the
ONE primary action derived from current state (readiness > onboarding >
campaign > approvals > else). KPI strip + panels move below. Add a
"Continue where you left off" pill.

Files: frontend/index.html (Dash shell), pages/dash.js (state-derived
CTA), router.js (continue-where-left-off persistence), styles.css.

Acceptance: Dash has one obvious CTA at all times; CTA changes when
state changes. Polls on page-show + after mutations.

Deferred: rich animation, telemetry on CTA click.
```

---

## A6 — Settings Consolidation

**Objective:** Settings is grouped by Setup / Operations / Governance /
Integrations / Diagnostics. Quick drawer becomes status + shortcuts.

**Agent team:** same as A5.

### Files

- Modify: `frontend/js/pages/settings-page.js`, the various
  panels (`profiles-panel.js`, `installer-panel.js`, etc.),
  `frontend/index.html`, `frontend/css/styles.css`.

### Tasks

1. Tabbed Settings page with 5 sections per the recommended IA.
2. Quick drawer (currently `run-config-popover`) shrinks to: provider
   status, current scope, current toolpacks, override toggle, "Open
   Settings" link.
3. Provider state shows `configured | reachable | missing | proxy-backed | failed` instead of a binary connection dot.

### Acceptance

- Each Settings section maps to an operator task, not a code module.
- No bare provider dot; status is explicit.

### Goal prompt

```markdown
Consolidate Settings into tabs: Setup | Operations | Governance |
Integrations | Diagnostics. Quick drawer becomes status + shortcuts
only. Provider state surfaces configured|reachable|missing|proxy-backed
|failed instead of a binary dot.

Files: pages/settings-page.js, profiles/installer panels,
frontend/index.html, styles.css.

Acceptance: every Settings section maps to an operator task; provider
state is explicit; quick drawer stops duplicating advanced settings.

Deferred: setting search, per-section permalinks.
```

---

## A7 — Alerts → Incidents

**Objective:** Findings get a triage workflow: status, required notes
on risky dismissals, source run/campaign attribution, evidence/report
actions.

**Agent team:** same as A5.

### Files

- Modify: `frontend/js/pages/alerts-page.js`, the alerts drawer markup,
  `server/assets/asset-store.js` (status + dismissal_note columns if
  not present), `server/routes/api.js`, `frontend/css/styles.css`.

### Tasks

1. Findings get a `triage_status` (`new|acknowledged|in_progress|dismissed|closed`)
   and a `dismissal_note` (required for `high|crit` dismissals).
2. Alerts page filters by triage_status + severity + scope.
3. Selected alerts can be added to evidence/report.
4. Source attribution: every finding row shows the run + campaign that
   surfaced it.

### Acceptance

- High/crit dismissal requires a note.
- Status persists across reloads.
- "Add to evidence" pipes the selected alert into the active campaign's
  Evidence pane.

### Goal prompt

```markdown
Add triage to findings. Statuses: new|acknowledged|in_progress|
dismissed|closed. high|crit dismissal requires a note. Filter by
status + severity + scope on the alerts page. Selected alerts can be
added to evidence/report. Every row shows source run + campaign.

Files: alerts-page.js + drawer markup, asset-store.js (schema add for
triage_status + dismissal_note + note_required guard), routes/api.js,
styles.

Acceptance: dismissing crit requires note; status persists; "Add to
evidence" attaches to the current campaign's Evidence pane.

Deferred: assignee, SLA, escalation, paging.
```

---

## A8 — React + Tailwind + shadcn/ui Migration

**Objective:** Replace bespoke components with shadcn/ui primitives
running on React + Tailwind. Preserve the cool-slate SEC look
pixel-for-pixel.

Previously documented as Thread 3 in
`2026-05-20-phantom-onboarding-and-react-migration.md`. Kept verbatim
here as A8 phases A8.0–A8.5.

**Agent team:** `Plan` (sequence) ∥ `Explore` (component inventory) →
`feature-dev:code-architect` (skeleton + Vite + Tailwind config +
coexistence strategy) → `general-purpose` (implementation, one phase at
a time) → `feature-dev:code-reviewer` (per-phase verify).

### Phase A8.0 — Infrastructure (no UI change)

Add React 18 + Vite 5 + Tailwind 3.4 + shadcn/ui (CLI-scaffolded into
`frontend/src/components/ui/`). `tailwind.config.ts` maps theme.colors
to the existing CSS variables so palette is identical. Build emits
`dist/legacy/` + `dist/react/`. `server/index.js` gets a `REACT_PAGES`
set; empty default = nothing flipped over.

### Phase A8.1 — Migrate Campaigns

| Hand-rolled (now)        | shadcn/ui (after)              |
|--------------------------|--------------------------------|
| `cf-chip-picker`         | `ToggleGroup` (multi)          |
| `cf-segmented`           | `ToggleGroup` (single) / `Tabs`|
| `cf-risk-grid`           | `Checkbox` grid + `Badge`      |
| `campaign-pill`          | `Badge` variants               |
| Drawer                   | `Sheet`                        |
| Create overlay           | `Dialog`                       |
| `cf-prompt-preview`      | `<pre>` inside `Card`          |

React Query owns campaign list + replay queries; mutations invalidate
on `onSuccess`. Live prompt preview is React state, no rerender plumbing.

### Phase A8.2 — Migrate Settings + Scope builder

Tabs → `Tabs`. Toolpack rows → `Accordion` + `Button` + `Badge`. Scope
action matrix → `RadioGroup` per row. Goals card → `Form` + shadcn
equivalents.

### Phase A8.3 — Migrate Runs + Graph chrome + Artifacts

Run detail tabs → `Tabs`. Run meta drawer → `Sheet`. Artifacts list →
`DataTable` (shadcn/ui + tanstack-table). Graph stays canvas; chrome
migrates.

### Phase A8.4 — Migrate Dash + Onboarding + Approvals + Alerts

Cockpit panels → `Card`. Onboarding checklist → `Checkbox` list +
`Button`. Approvals cards → `Card` + `Dialog` for "Raw details".
Alerts page → `DataTable`.

### Phase A8.5 — Cleanup

Delete the vanilla bundle; delete migrated `frontend/js/` modules;
remove `cf-*`, `campaign-*`, `goals-*` sections from `styles.css`.

#### A8.5b parity-close — DONE (2026-05-21)

All 8 documented per-page parity gaps are closed in the React bundle
(see the 2026-05-21 DEVLOG entry): Dash sparklines + governance card,
Alerts grid/map/search/export + lazy Asset tab, Approvals KPI strip +
decision-history, Settings 3 placeholder tabs filled, Scope full
builder, Runs replay scrubber + LLM synthesis, Graph read-only SVG v1,
Artifacts sandboxed inline preview. Also landed: shared `AppShell`
(sidebar + breadcrumb), dependency-free Toast/Tooltip/Progress/Spinner,
`Button loading`, `ListRow`, `motion-reduce` guards, and `--ok-2` /
`--warn-2` status tokens. `npm run test:frontend` 143/143; tsc clean.

**The structural deletion below is still NOT done** — the legacy
`frontend/js/` modules + CSS sections remain as the `git revert` safety
net until the React surfaces are browser-verified. That deletion is the
remaining A8.5b commit.

#### A8.5b residual deferrals (follow-ups, non-blocking)

These were scoped out of the parity-close pass and need their own small
commits — none block the legacy deletion:

1. **Scope dry-run policy preview** — port `/api/scopes/evaluate-draft`
   into the React builder (legacy showed a live policy preview).
2. **Scope ROE rate-caps / active-hours / blackout-windows editors** —
   currently loaded from ROE templates but not editable in the create
   form (only `action_modes` + ROE prose are applied).
3. **Runs replay via `/api/runs/:id/replay`** — the scrubber currently
   steps over already-loaded `useRunEvents`; the richer replay endpoint
   (graph-linked stepping) is unused.
4. **Settings write-paths** — Prompts / Security&Scope / Tools-MCP-Skills
   tabs are read-only inventories; create/edit/upload deep-link to the
   legacy builders.
5. **Synthesis next-step actions** — `rerun` / `summary` actions route to
   `/graph` or `/scope` rather than triggering a re-run; needs handlers.
6. **Graph interactive canvas** — full physics/drag/pan renderer remains
   deferred (A8 "Deferred" list); the v1 SVG is read-only.
7. **a11y:** Radix `DialogContent` missing `aria-describedby` warning —
   add descriptions in a later a11y sweep.

### Token mapping (`tailwind.config.ts`)

```ts
theme.extend.colors = {
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
};
```

### Acceptance (whole A8)

- All routed pages migrated.
- `sec-ui-kit.test.js` rewritten against the React bundle; cool-slate
  + no-green-accent assertions survive verbatim.
- `frontend/css/styles.css` shrinks ≥40% (~7100 → ≤4200 lines).
- JS bundle regression ≤25%.
- `npm test` (server) + `npm run test:frontend` (Vitest) both green at
  every phase boundary.
- Visual parity within 1px per page.

### Goal prompt (whole A8)

```markdown
Migrate PHANTOM's frontend from vanilla JS + hand-rolled CSS to
React 18 + Vite 5 + Tailwind 3.4 + shadcn/ui (CLI-scaffolded into
frontend/src/components/ui/). Gradual coexistence: dist/legacy/ +
dist/react/, REACT_PAGES set in server/index.js flips routes one at a
time. Preserve cool-slate SEC palette pixel-for-pixel via tailwind
theme that consumes --cy-*, --fg-*, --line-* variables.

Phases (each is its own commit):
  A8.0 Infrastructure (no UI change)
  A8.1 Campaigns
  A8.2 Settings + Scope
  A8.3 Runs + Graph chrome + Artifacts
  A8.4 Dash + Onboarding + Approvals + Alerts
  A8.5 Cleanup (delete legacy bundle + migrated modules + cf-*/
       campaign-*/goals-* css sections)

Component mapping (A8.1):
  cf-chip-picker → ToggleGroup (multi)
  cf-segmented   → ToggleGroup (single) or Tabs
  cf-risk-grid   → Checkbox grid with Badge severity ticks
  campaign-pill  → Badge variants
  drawer         → Sheet
  create overlay → Dialog
  cf-prompt-preview → <pre> in Card

Tooling: React Query (fetch+cache+invalidate), Zustand (cross-page
state), react-router-dom, Vitest + Testing Library. No Redux. No RSC.

Operating rules:
- Each phase is a separate commit/PR.
- Run npm test + npm run test:frontend at every phase boundary.
- sec-ui-kit.test.js is REWRITTEN against the React bundle; cool-slate
  token + no-green-accent assertions survive verbatim — that's the
  regression bar.
- styles.css must drop ≤4200 lines after cleanup.
- Bundle regression ≤25%.

Acceptance: all routes migrated; visual parity within 1px; tests green
at every phase boundary.

Deferred: Storybook/Ladle, RSC/Next.js, canvas graph renderer
replacement, mobile-first variant beyond responsive breakpoints.
```

---

## A9 — Responsive + Accessibility

**Folded into A8 phases.** Each page that gets ported in A8 also gets:

- Breakpoints: ≥1280 full · 900–1279 two-column / collapsible ·
  640–899 single-column / sticky actions · <640 read/triage only.
- ARIA roles/labels via shadcn/ui Radix-backed primitives (free with
  the migration).
- Visible focus rings (Radix focus-visible + Tailwind `ring`).
- Reduced-motion variants via Tailwind's `motion-reduce` modifier.

### Acceptance (per-page, during A8 review)

- No horizontal overflow at 390 / 768 / 1024 / 1440px.
- Onboarding, create scope, start run, approve/deny, create campaign,
  run next goal, export evidence are keyboard-completable.

---

## A10 — Terminology / Docs / Demo

**Objective:** Glossary + operator-action copy + safe synthetic demo
labeling.

**Agent team:** `Explore` → `general-purpose`.

### Files

- Modify: `README.md`, `DEVLOG.md`, `user-docs/`, copy across the
  frontend, `scripts/seed.js` (watermark all demo rows).
- Create: `user-docs/glossary.md`.

### Tasks

1. Compile glossary of PHANTOM terms (campaign, run, goal, scope, …).
2. Sweep frontend copy for backend-leaking phrases ("POST /api/X" →
   "Click the New X button").
3. Demo data: every seeded row must carry `metadata.demo=true` AND a
   visible `[demo]` prefix; the UI shows a "Synthetic demo data"
   watermark on demo-tagged rows.

### Acceptance

- Glossary lands in user-docs.
- No frontend copy tells the operator to run curl or POST anything.
- Demo data is unmistakably labeled.

### Goal prompt

```markdown
Add a glossary, sweep operator-facing copy, and watermark all demo
data. user-docs/glossary.md defines campaign/run/goal/scope/finding/
approval/toolpack/profile/etc. Replace any "POST /api/X" instruction
copy with "Click the New X button" or equivalent. Demo seed rows
carry metadata.demo=true AND a [demo] prefix; UI shows a "Synthetic
demo data" watermark wherever they appear.

Files: README.md, DEVLOG.md, user-docs/glossary.md (new), frontend
copy sweep (chat / dash / campaigns / scope / settings), scripts/
seed.js (watermark every row), frontend/css/styles.css (watermark
style).

Acceptance: glossary present; no curl/POST instructions in frontend
copy; demo rows unmistakable.

Deferred: i18n; multi-language docs.
```

---

# Workstream B — Governed Toolpack Registry

## B0 — Manifest Schema Spike

**Objective:** Define `toolpack.phantom.dev/v1` manifest schema + a
validator. Represent every existing built-in toolpack as a fixture
manifest. No runtime behavior change.

**Agent team:** `feature-dev:code-architect` (schema design) →
`general-purpose` (validator + fixtures) →
`feature-dev:code-reviewer`.

### Files

- Create: `server/registry/manifest-schema.json`,
  `server/registry/manifest-validator.js` + test,
  `server/registry/fixtures/<toolpack-id>.manifest.json` for every
  built-in.
- Modify: `docs/registry/` (new) with manifest field reference,
  risk/action class table.

### Schema sections (verbatim from Hermes audit)

- `identity`: id, name, summary, category, version, channel, publisher, license, homepage
- `compatibility`: phantom_min/max, platforms, container_profiles
- `trust`: digest, signature, signed_by, provenance/attestation ref
- `risk`: action_classes, default_allowed/ask/deny, scope_required, target_required, rate caps, network egress, credential rules
- `install`: declarative recipes (NO shell strings), privilege requirements, rollback hints
- `tools`: command metadata, risk class, scope requirement, parser, gated flag, expected outputs
- `prompt`: reviewed prompt fragments (descriptive, not enforcement)
- `outputs`: parsers + finding/report mappings
- `templates`: scopes, campaigns, reports/evidence
- `docs`: readme / examples
- `review`: security review flags, exploit/destructive/auth flags
- `lifecycle`: deprecation, revocation, replacement versions

**Key invariant:** manifest data **describes** capability; it does not
**execute** capability.

### Acceptance

- Validator accepts a valid v1 manifest.
- Rejects: unknown schema version, unknown action/risk class,
  shell-string install recipes, missing required `risk.action_classes`,
  missing `trust.digest`.
- Every built-in toolpack has a passing fixture.

### Goal prompt

```markdown
Define toolpack.phantom.dev/v1 manifest schema (sections: identity,
compatibility, trust, risk, install, tools, prompt, outputs, templates,
docs, review, lifecycle) + a validator + fixtures for every existing
built-in toolpack.

Files: server/registry/manifest-schema.json, manifest-validator.js
(+test), fixtures/<id>.manifest.json per built-in, docs/registry/
manifest.md (field reference + risk/action class table).

Invariant: manifests DESCRIBE capability, never EXECUTE it. Reject
shell-string install recipes; require declarative arrays only.

Acceptance: validator passes every built-in fixture; rejects unknown
schema/action/risk, shell-string recipes, missing trust.digest.

No runtime behavior change in this phase — schema + fixtures only.
```

---

## B1 — Local Registry Client + Catalog Unification

**Objective:** Runtime + build-time catalogs stop silently drifting.
PHANTOM can preview import/update/rollback **without** a hosted
registry. Built-in fallback survives if any registry is unavailable.

**Agent team:** same as B0.

### Files

- Create: `server/registry/client.js` (load local manifests + verify),
  `server/registry/cache-store.js` (schema additions),
  `server/registry/policy-mapper.js` (manifest risk → policy gate),
  `server/routes/registry-api.js` (mounted under `/api/registry/*`).
- Modify: `server/toolpacks/toolpack-registry.js` (resolver consumes
  manifests; falls back to the existing JS registry when manifest
  absent), `server/tools/installer*.js` (install plan from declarative
  recipes), `server/profiles/profile-store.js` +
  `profile-resolver.js`, `scripts/install-profile.sh`,
  `scripts/build-variants.js` (emit/validate manifest metadata at build
  time).

### DB additions (minimum for B1+B2)

- `registry_sources`, `registry_indexes`, `registry_manifests`,
  `registry_packages`, `toolpack_pins`, `installed_packages`,
  `registry_decisions`, `package_audit_events`, `registry_revocations`,
  `run_package_snapshots`.

### API Shape (B1 surface)

- `GET /api/registry/local` → list of loaded local manifests
- `GET /api/registry/local/:id` → manifest detail
- `POST /api/registry/local/:id/preview-install` → declarative plan
  (no execution)
- `POST /api/registry/local/:id/preview-rollback` → declarative plan
  (no execution)

### Acceptance

- Every built-in toolpack still works when manifest fallback is
  triggered (delete one manifest file, restart, that toolpack still
  loads from the JS registry).
- Install plan preview is identical (deep-equal) between manifest
  resolver and existing JS path for parity-mode toolpacks.
- Signature/digest failures fail closed.

### Goal prompt

```markdown
Build the local registry client + unify catalogs. Manifest-driven
loader sits in front of the existing JS registry; JS registry remains
the fallback so behavior parity is maintained.

Files: server/registry/{client.js, cache-store.js, policy-mapper.js}
(+tests), routes/registry-api.js, integrations into toolpacks/
installer/profiles/scripts.

DB additions per Hermes plan: registry_sources, registry_indexes,
registry_manifests, registry_packages, toolpack_pins,
installed_packages, registry_decisions, package_audit_events,
registry_revocations, run_package_snapshots.

API: GET /api/registry/local, /:id, POST /:id/preview-install,
/:id/preview-rollback (preview only — no execution this phase).

Acceptance: existing built-ins work unchanged; manifest path matches
JS-path install plan deep-equal; signature/digest failures fail closed;
built-in offline fallback covered by tests.

Rollback: keep the JS registry as the fallback resolver until
manifest-path parity is proven by tests + dogfood.
```

---

## B2 — Registry UI + Local Import MVP

**Objective:** Operator can import a LOCAL manifest, preview risk +
install impact, store it disabled, explicitly enable it, and queue
install through Approvals. No hosted registry yet.

**Agent team:** `Explore` → `feature-dev:code-architect` →
`general-purpose` → `feature-dev:code-reviewer`.

### Files

- Create: `frontend/js/pages/registry-page.js`,
  `frontend/js/registry/registry-presenter.js` + test.
- Modify: `server/routes/registry-api.js` (import/enable/disable/
  install endpoints), approvals page (registry event types),
  `server/scope/policy.js` (consume manifest risk metadata),
  `frontend/index.html` (nav entry + page shell),
  `frontend/css/styles.css` (or shadcn/ui equivalents if A8 has
  landed for Settings/Toolpacks).

### API Shape (B2 additions)

- `POST /api/registry/import` body `{ source: 'local|file', path? }` → imported-disabled
- `POST /api/registry/packages/:id/enable` / `/disable`
- `POST /api/registry/packages/:id/install` → creates approval, does NOT execute
- `POST /api/registry/packages/:id/remove` → approval-gated

### Acceptance

- Imported packages land **disabled**.
- Enable is a separate operator action.
- Install creates an approval and does NOT execute until approved.
- Playwright smoke covers browse → preview → import → approval queue.

### Goal prompt

```markdown
Add a Registry page + local-import MVP. NO hosted registry yet — only
local manifests. Flow: import (disabled by default) → enable →
preview install → queue approval. Approvals page renders registry
event types (extends A3).

Files: pages/registry-page.js, registry/registry-presenter.js
(+test), routes/registry-api.js (import/enable/disable/install/remove
endpoints), policy.js (consume manifest risk), index.html (nav + shell),
styles.

Acceptance: imported manifests land disabled; enable is a separate
action; install queues approval and does NOT execute until approved;
Playwright smoke for browse → preview → import → approval queue.

Deferred: hosted registry, signing-key UI, rollback (lands in B3).
```

---

## B3 — Private Hosted Signed Registry MVP

**Objective:** A private registry source can be added by URL + pinned
public key; PHANTOM fetches, verifies, imports, pins, updates, rolls
back. Downtime falls back to local cache + built-ins.

**Agent team:** `feature-dev:code-architect` (control plane shape) →
`general-purpose` (PHANTOM client + control plane) →
`feature-dev:code-reviewer` (signature + threat model).

### Files (PHANTOM side)

- Modify: `server/registry/client.js` (remote fetch + signature
  verify), `server/registry/cache-store.js`,
  `server/routes/registry-api.js` (source-add, fetch-index,
  rollback).

### Files (control plane, separate repo or `infra/`)

- New service (Node + Postgres + signing service): submission, review,
  signing, static-signed output to object storage.
- Layout per Hermes audit:
  ```
  https://registry.phantom.example/
    index.json
    index.json.sig
    revocations.json
    revocations.json.sig
    packages/<id>/<version>/{manifest.json, manifest.json.sig, sbom.json, README.md}
  ```

### Trust model (verbatim)

- No source trusted by default.
- Add-source requires pinned public key.
- Fetched index informational until signature verified.
- Import rejected if schema invalid, signature invalid, digest mismatch,
  unsupported PHANTOM version, unknown risk/action class, unsupported
  install recipe, parser/template invalid, secret scan failure.
- Unsigned local/dev manifests require an explicit audited setting and
  are never enabled by default.
- Registry content can NEVER grant itself broader local policy.

### Acceptance

- Private signed pack fetched, verified, imported, pinned, updated,
  rolled back end-to-end.
- Downtime: built-ins + cached imports keep working; UI shows a
  stale-cache warning.
- Tampered signature is hard-rejected.
- Registry receives no targets / prompts / outputs / traces / secrets.

### Goal prompt

```markdown
Stand up a private hosted signed registry MVP + wire PHANTOM to it.
Static-signed layout: index.json + index.json.sig + revocations.json
+ revocations.json.sig + packages/<id>/<version>/{manifest.json,
manifest.json.sig, sbom.json, README.md}.

Files (PHANTOM): server/registry/client.js (remote fetch + verify),
cache-store.js, routes/registry-api.js (source-add, fetch-index,
rollback).

Files (control plane): a separate Node + Postgres + signing service.
Submission → review → signing → object storage. Admin/review/signing
plane is PRIVATE; only the signed catalog is public-shaped.

Trust model: no source trusted by default; pinned public key required;
fetched index informational until verified; tampered signature hard-
rejected. Registry receives NO targets/prompts/outputs/traces/secrets.

Acceptance: end-to-end fetch → verify → import → pin → update →
rollback. Downtime → built-ins + cached imports keep working;
stale-cache warning on UI. Tampered signature rejected.

Tests cover signature verify, digest verify, downtime fallback,
tampered-signature rejection, and "no operator data leaves the host."

Deferred: public read path (B5), reviewer UI polish, signing-key
rotation drill (B4).
```

---

## B4 — Governance Hardening

**Objective:** Role-based review workflow, revocation feed, audit
export, monitoring/alerting, backup/restore, incident runbooks.

**Agent team:** `feature-dev:code-architect` (governance model) →
`general-purpose` (implementation) → `feature-dev:code-reviewer`
(security review).

### Tasks

1. Roles in the control plane: submitter, reviewer, release manager,
   signing operator.
2. Revocation feed PHANTOM clients poll on the registry source.
3. Audit export to JSONL / SARIF / SIEM.
4. Monitoring + alerting on failed verifies, signing-key usage, abuse
   patterns.
5. Backup + restore drills.
6. Incident runbooks: bad-release, signing-key compromise, registry
   compromise.

### Acceptance

- Malicious manifest rejected end-to-end (review + tooling).
- Bad release revoked → PHANTOM clients see the revocation and warn /
  block on next fetch.
- Signing-key rotation drill passes.
- Restore test passes.

### Goal prompt

```markdown
Harden the registry governance. Role-based review workflow (submitter
| reviewer | release manager | signing operator). Revocation feed
PHANTOM polls on each source. Audit export to JSONL/SARIF/SIEM.
Monitoring + alerting on failed verifies, signing-key usage, abuse.
Backup + restore drills. Incident runbooks for bad-release / signing-
key compromise / registry compromise.

Files: control-plane service (RBAC + revocation feed + audit export),
PHANTOM registry client (revocation poll + warning UI), docs/runbooks/.

Acceptance: malicious manifest rejected; bad release revoked + clients
warn/block; key rotation drill passes; restore test passes.

Deferred: public read path (B5).
```

---

## B5 — Public Read Path + Ecosystem Expansion

**Objective:** Public clients read a signed stable catalog
unauthenticated; admin/review/signing plane stays private.

**Agent team:** same as B4.

### Tasks

1. Static signed CDN/object-storage catalog (mirror of the private
   one).
2. Public docs / transparency page.
3. Restricted channel controls (stable/preview/dev channels).
4. Maintainer portal + validation CLI if external maintainers accepted.

### Acceptance

- Public read path is signed + cacheable + rate-limited.
- Admin/review/signing plane unreachable from the public path.
- WAF/rate/cost controls alert under synthetic abuse.
- Offline mirror/export/import works.

### Goal prompt

```markdown
Open the read path. Static signed CDN mirror of the private catalog;
admin/review/signing stays private. Public docs + transparency page.
Stable/preview/dev channel controls. Optional maintainer portal +
validation CLI if external maintainers accepted.

Files: infra (static CDN + object storage); docs/transparency.md;
optional maintainer-portal repo.

Acceptance: public clients read signed catalog unauthenticated;
admin plane unreachable; WAF/rate/cost alerts fire under synthetic
abuse; offline mirror works.

Deferred: marketplace UI, community submissions at scale.
```

---

# Release Gates

## Internal Alpha

**Required:** A0 done · A1 mostly done · A2 done (already shipped) · B0 done.

**Proof:**
- `npm test` green.
- `npm run build` green with no new warnings.
- Fresh DB → diagnostics card + onboarding checklist visible on Dash.
- Campaign create/start/pause/resume/cancel/run-next works from UI.
- No primary page hangs on a route failure.

## Product Beta

**Required:** A0–A3 done · A4 Evidence MVP done · A6 Settings done · B1 done.

**Proof:**
- Fresh install → Diagnostics → provider → authorized scope →
  run/campaign → approval → finding → evidence export, all via UI
  without curl/devtools.
- Built-in toolpacks resolve through local manifests via the unified
  catalog.
- Unknown manifest classes + signature/digest failures rejected.

## Final Local-First Release

**Required:** A0–A10 done · A8 cleanup phase done · B0–B1 done · B2
optional unless hosted registry is part of the release promise.

**Proof:**
- Loading/empty/error/retry states on every primary route.
- Responsive at 390 / 768 / 1024 / 1440px.
- Keyboard-completable workflows.
- Demo mode honest + safe.
- Glossary / labels / docs aligned.
- Evidence exports redact secrets.

## Hosted Registry Dogfood

**Required:** B2 done · B3 done · A3 + A6 support registry events.

**Proof:**
- Private signed registry publishes a passive/safe pack.
- PHANTOM fetches → verifies → previews → imports → pins → updates →
  rolls back.
- Downtime → built-ins + cached imports operational.
- Audit rows record every step.

## Public Registry Readiness

**Required:** B3 + B4 done.

**Proof:**
- Bad-release drill + signing-key compromise drill pass.
- Restore test passes.
- Public read path static-signed; admin plane private.
- Synthetic abuse alerts fire.

---

# Open Decisions (resolve before / during execution)

1. **Dash vs Operations naming.** I lean Dash for muscle memory; revisit at A5.
2. **Evidence vs Artifacts as the user-facing label.** Recommend Evidence (operator-friendly wrapper); decide at A4.
3. **Supervised vs autonomous campaigns for final release.** Supervised is enough; autonomous loop is deferred.
4. **Markdown vs JSON evidence export default.** Recommend Markdown for operator; JSON available via the same endpoint.
5. **Single trusted operator vs RBAC.** Local-first single-operator OK for v1; RBAC is a follow-up before broader deployment.
6. **Signing standard.** Sigstore/cosign if clean Node verify is feasible; minisign-style detached signatures otherwise.
7. **Manifest source-of-truth timing.** Recommend dual-source-of-truth during B1 (JS registry generates+validates manifests); cut over once parity proven.
8. **Demo data philosophy.** Watermarked synthetic seed OK; never use real targets.

---

# Cross-Workstream Dependency Graph (executable order)

```text
A0 ──┐
     ├─► A1 ──► A1b ──► (A2 done) ──► A3 ──► A4 ──► A5 ──► A6 ──► A7 ──► A8.0 ──► A8.1 ─► A8.2 ─► A8.3 ─► A8.4 ─► A8.5 ──► A10
     │                                                                                                                       │
     └─► B0 ──► B1 ──► B2 ──► B3 ──► B4 ──► B5 ─────────────────────────────────────────────────────────────────────────────┘
```

Concrete ordering (each step = one focused PR / commit):

1. A0 — Diagnostics + readiness card.
2. A1 — Onboarding checklist + empty-state pass + demo seed.
3. A1b — Local network discovery + Assets scan modal.
4. B0 — Manifest schema + validator + built-in fixtures *(parallel with A1/A1b).*
5. A3 — Approval explainability.
6. A4 — Unified Evidence tab + redaction.
7. A5 — Dash IA + primary CTA.
8. A6 — Settings consolidation.
9. A7 — Alerts → incidents triage.
10. B1 — Local registry client + catalog unification.
11. A8.0 — React/Tailwind/shadcn infrastructure.
12. A8.1 — Migrate Campaigns.
13. B2 — Registry UI + local import MVP (lands on top of React or
    vanilla depending on A8.1 timing).
14. A8.2 — Migrate Settings + Scope.
15. A8.3 — Migrate Runs + Graph chrome + Artifacts.
16. A8.4 — Migrate Dash + Onboarding + Approvals + Alerts.
17. A8.5 — Cleanup (delete legacy bundle + migrated modules + cf-* CSS).
18. A10 — Glossary + copy sweep + demo watermark.
19. B3 — Private hosted signed registry MVP.
20. B4 — Governance hardening.
21. B5 — Public read path.

---

# Immediate Next Implementation Batch

Per the Hermes audit's recommendation, the first focused batch:

1. `/api/diagnostics` (A0) with redacted checks + Dash card + Settings
   panel.
2. Frontend fetch helper with timeout/error shape + shared loading /
   empty / error cards (A0 infrastructure).
3. Replace Dash empty state with the onboarding checklist (A1).
4. Track `scripts/seed.js` + add `npm run seed` (A1).
5. Manifest schema spike (B0).
6. Component inventory + Tailwind theme spike (A8.0 preparation —
   research only, no migration).

Items 1–4 ship as one "Phase A0 + start of A1" PR. Items 5–6 ship as
parallel research-only commits so B0 + A8 can start without blocking
the polish PR.

---

# Verification Pipeline

Run before claiming any phase complete:

```bash
cd ~/projects/PHANTOM
npm test
npm run build
find server frontend/js -name '*.js' -not -path '*node_modules*' \
  -print0 | xargs -0 -n1 node --check
python3 tests/smoke_test.py
python3 tests/graph_viewer_smoke.py
git diff --check
```

After A8.0 lands, additionally:

```bash
npm run test:frontend
npm run build:react
```

After B0 lands, additionally:

```bash
npm test -- server/registry/manifest-validator.test.js
```

---

# Single Goal Invocation

To execute the entire mega-plan with one command:

```
/goal follow docs/plans/2026-05-20-phantom-mega-plan.md
```

To execute a single phase:

```
/goal follow A0 of docs/plans/2026-05-20-phantom-mega-plan.md
/goal follow A1 of docs/plans/2026-05-20-phantom-mega-plan.md
/goal follow B0 of docs/plans/2026-05-20-phantom-mega-plan.md
...
```

To execute a workstream:

```
/goal follow Workstream A of docs/plans/2026-05-20-phantom-mega-plan.md
/goal follow Workstream B of docs/plans/2026-05-20-phantom-mega-plan.md
```

To execute through a release gate:

```
/goal follow internal-alpha of docs/plans/2026-05-20-phantom-mega-plan.md
/goal follow beta of docs/plans/2026-05-20-phantom-mega-plan.md
/goal follow final-local-first of docs/plans/2026-05-20-phantom-mega-plan.md
```

The agent team handles the routing — each section in this document
contains a self-contained goal prompt + agent team assignment + files +
tasks + acceptance + deferred items so the receiving fleet can act
without re-reading the source artifacts.

---

# Bottom Line

PHANTOM should finish the local operator experience and manifest
contract before treating registry hosting as product infrastructure.
The product becomes credible when an operator can see system
readiness, define authorized scope, run or supervise Campaigns,
understand every block/approval, export evidence, and know exactly
which toolpack/profile/manifest versions were used. The hosted
registry then becomes a signed distribution layer for already-governed
local capabilities, not a new trust bypass.

> **muahahahaha** — single goal, fleet of agents, ship it. 🐺
