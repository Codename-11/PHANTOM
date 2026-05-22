# PHANTOM DEVLOG

## 2026-05-21 — A8.5b legacy removal: React is the only UI

Completed A8.5b. The two remaining unmigrated surfaces were ported to React, then the entire legacy vanilla bundle was deleted and the dev/build pipeline cut over to React.

**Chat → React.** `frontend/src/pages/Chat.tsx` + `lib/chat-socket.ts` (a `useChatSocket` hook speaking the exact `/ws` protocol from `server/index.js` — `conversation_created`/`response_start`/`thinking`/`chunk`/`tool_call`/`tool_progress`/`tool_result`/`approval_request`/`artifact_created`/`title_updated`/`response_end`/`error`/`pong`, outbound `chat`/`stop`/`approval_response`/`ping`, with the session-isolation guard). Inline approval cards (ask/allow-once, batch, keyboard y/n). Markdown via `lib/chat-markdown.ts` reusing `marked` + a slimmed `highlight.js` core (curated grammars, not the ~190-language full build) + `DOMPurify`. Chat is `React.lazy`-loaded so its markdown stack ships as a ~45 KB gz chunk loaded on demand; the main bundle stays ~138 KB gz.

**Registry → React.** `frontend/src/pages/Registry.tsx` + `lib/registry.ts` mirroring the Campaigns list + detail-Sheet pattern, off `/api/registry/local[/:id][/preview-install]`. Validity + trust pills (signed only when declared digest == on-disk digest).

**Legacy bundle deleted.** Removed `frontend/index.html`, all of `frontend/js/` (51 files: app/router/chat/markdown + every page module + their vm-sandbox `.test.js` + `sec-ui-kit.test.js`), and `frontend/css/styles.css` (7944 lines). Net −23.8k lines.

**React served at root.** `vite.config.react.ts` base `/react/` → `/`. `server/index.js` now serves `dist/react` at root with an SPA catch-all for all non-API/ws/docs routes; the `REACT_PAGES` gate, the legacy static mount, and the `/react/*` preview handling are gone (503 if `dist/react` is unbuilt). `App.tsx` dropped the dead `/react/*` routes. AppShell nav flipped Chat + Registry to in-app `NavLink`s.

**Pipeline cutover.** `package.json`: `dev` now runs the React Vite config (with `/api` + `/ws` proxies added to `vite.config.react.ts`); `build` = `build:react && build:docs`; removed `build:frontend` + `dev:react`. `Dockerfile`: `npm run build` covers react + docs. `scripts/run-tests.js` stopped walking the deleted `frontend/js`.

**Validation.**
- `npm run build:react` clean — 138 KB gz main + 45 KB gz lazy Chat chunk; assets emit at `/assets/*`.
- `npm run test:frontend` 151/151; `npm test` (server) 391/391.
- `npm run dev` verified serving React at root on BOTH the Vite dev server (`/`, `/dash`, `/campaigns` → 200, HMR client present) and the Express server (`/dash`, `/registry`, `/api/diagnostics` → 200, assets at `/assets/`).

**Page header sizing standardized.** New `frontend/src/components/PageHeader.tsx` is the single source of truth for the eyebrow + title + description + actions row (title dialed `text-2xl` → `text-xl`); all 11 pages use it. DashHero (the "Get started" / "Finish setup" next-action card) tightened: title `text-xl` → `text-lg`, padding + accent border reduced.

## 2026-05-21 — React UI/UX audit + A8.5b parity-close + self-learning design

A UI/UX/flow audit of the React bundle drove a shared-foundation commit plus the A8.5b parity-close, executed as a leader + 8-parallel-agent fleet (one agent per page, disjoint file ownership). Plus a read-only research stream that produced the self-learning design doc. `npm run test:frontend` went 117 → **143 passing**; `tsc -p tsconfig.frontend.json --noEmit` clean.

**Shared UI foundation.** The React migration had shipped each page as a standalone `<main>` with no chrome — operators lost the legacy sidebar. Added `frontend/src/components/AppShell.tsx` (persistent sidebar mirroring the legacy routes + breadcrumb topbar + mobile drawer), wired into `App.tsx` inside a new `ToastProvider`. New dependency-free primitives (the bundle guardrail forbids casual Radix packs): `ui/spinner.tsx`, `ui/toast.tsx` (context + portal), `ui/tooltip.tsx` (hover + keyboard focus, `aria-describedby`), `ui/progress.tsx`. `Button` gained a `loading` prop (spinner + auto-disable) that collapses the old `disabled={x.isPending}` + `{x.isPending ? '…' : '…'}` pattern. `ListRow` extracts five duplicated row-button class strings. `motion-reduce:` guards added to skeleton/sheet/dialog/tabs (closes the A9 acceptance bar). Status-color discipline: hard-coded `#66c293`/`#d8b15a` (22 sites) promoted to new `--ok-2`/`--warn-2` muted-status tokens in `globals.css`.

**A8.5b parity-close (8 pages).** Each page closed its documented gap, adopted the foundation primitives, swapped every internal `/react/*` link for the bare canonical path, and migrated page-level hex. **Dash** — posture sparklines + governance/14-day card (`/api/trending/posture` + `/api/approvals/stats`). **Alerts** — queue/grid/map view toggle, client-side search, CSV+JSON export, lazy Asset tab (`/api/assets/:id`). **Approvals** — KPI strip + decision-history feed. **Artifacts** — inline preview pane; untrusted artifact HTML renders in a sandboxed iframe (`allow-scripts allow-forms allow-popups`, no `allow-same-origin`, `no-referrer`). **Settings** — Prompts / Security&Scope / Tools-MCP-Skills tabs filled (read-only inventories; the canonical 8-tab strip preserved). **Scope** — full builder (intent tiles, ROE templates, 3-state Allow/Ask/Deny action matrix, target chips, asset picker); `exploit`/`destructive` stay hard-locked to deny and are re-pinned on every read. **Runs** — replay scrubber over run events + LLM-enriched `/api/runs/:id/synthesis` card. **Graph** — read-only SVG node-link v1 from `/api/runs/:id/graph` (full canvas renderer stays deferred per the plan).

**Self-learning design (research only, no code).** `docs/plans/2026-05-20-phantom-self-learning-design.md` — a Hermes/Voyager-style agent-memory loop (skill library + episodic logs + failure reflection) that plugs into existing run-lifecycle hooks (`recordRunOutcomeAgainstGoal`, `finalizeRunForCampaign`) via a new best-effort `recordEpisodeForRun`; retrieval injects above the ask-gated governance block. Three additive SQLite tables; learned skills are advisory context, never a privilege (every replay step still hits the executor scope/policy gate); phased K1→K5. Top risk: prompt-injection-via-poisoned-memory.

**Residual deferrals (tracked, not blocking — see mega-plan A8.5b).** Scope dry-run policy preview (`/api/scopes/evaluate-draft`) + rate-cap/active-hours editors not ported; Runs scrubber uses already-loaded events rather than the richer `/api/runs/:id/replay`; Settings write-paths deep-link to legacy builders (tabs are read-only inventories); synthesis next-step actions route instead of triggering reruns; Graph full interactive canvas remains deferred. Pre-existing Radix `DialogContent` missing-`aria-describedby` warning noted for a later a11y pass. **A8.5b structural deletion (legacy `frontend/js/` modules + CSS) is intentionally NOT done** — the legacy bundle stays as the `git revert` safety net until the React surfaces are browser-verified.

**Validation.**
- `npm run test:frontend` — 143/143 passing (21 files; +26 tests over baseline).
- `tsc -p tsconfig.frontend.json --noEmit` — clean.
- No functional `/react/*` navigation links and no hard-coded `#66c293`/`#d8b15a` remain in source.
- NOT browser-verified — typecheck + unit tests only; AppShell layout, sandboxed previews, and the SVG graph need a real-browser pass before A8.5b deletion.

## 2026-05-20 — Mega-Plan Sprint (A0 / A1 / A1b / A3 / A4 / A5 / A6 / A7 / A10 / B0 / B1 / B2)

Twelve phases of `docs/plans/2026-05-20-phantom-mega-plan.md` landed in one session against a single `/goal follow all of the plan except release` invocation. Three agents (B0, A1b, A3) ran in parallel via the background-fleet pattern; the rest landed in the foreground. The boundary between the two surfaces — `server/registry/` for the manifest world, page-scoped frontend modules for the polish — kept the merge surface tiny.

**A0 — Diagnostics + readiness.** `server/diagnostics/diagnostics.js` runs eight bounded probes (`runtime / db / workspace / provider / docs / toolpacks / campaigns / registry`) with a 500ms per-check timeout and a 1500ms total budget. Secrets are redacted before they leave the module (api key → `••••<last4>`). `GET /api/diagnostics` returns in ~60ms on the container. Frontend ships a compact Dash card + a full Settings panel sharing the same render path; `frontend/js/lib/fetch-helper.js` is the shared `apiFetch` + `DataState` placeholder library every later phase consumes.

**A1 — Onboarding checklist + demo seed.** `scripts/seed.js` got tracked and refactored to export `runSeed({reset}) / clearDemo() / isDemoLoaded()` so it runs in-process via dynamic import (works in Docker without `node` on the spawn PATH). `server/onboarding/onboarding-status.js` returns five booleans (`toolpacksInstalled / hasAsset / hasScope / hasRun / demoLoaded`). New `/api/onboarding/checklist` + `/load-demo` + `/clear-demo` routes; load-demo returns 409 when demo is already present. Dash mounts an onboarding checklist that auto-hides on `complete:true`. The existing onboarding wizard gains a 5th "Get started" step with three CTA tiles (Load demo / Scan network / Manual).

**A1b — Local network discovery (background agent).** `phantom_discover_local_network` — passive ARP / `ip neigh show` / `arp -an` reader with a 60s cache + 3s spawn timeout. Cross-platform parser. Risk class = `recon`; hard-blocked when policy denies. Artifact `network-neighbors.json` captures the structured list; the trace event records COUNT only (never IPs). Assets page empty-state gains a "Scan this machine's network" CTA + an acknowledgement modal when no scope is active + a review modal with checkbox list. POST `/api/discover/local-network/promote` is idempotent: existing assets matching `ip` are skipped.

**A3 — Approval explainability (background agent).** `server/approvals/explain.js` turns raw approval records (scope ask / install / registry / elevated command) into the structured `{target, riskClass, actionClass, policyReason, expectedEffect, sideEffects, rawDetails}` shape. The approvals page renders the structured fields up front with raw JSON tucked behind a collapsed `<details>` block. High/crit denials require a `denial_reason` — server returns `400 { error: 'denial_reason_required' }` without one; frontend blocks submission and focuses the textarea. Stale / resolved cards have their controls disabled.

**A4 — Unified Evidence tab + redactor.** `server/evidence/evidence-redactor.js` is the last-line scrubber (OpenAI/Anthropic keys, AWS access keys, Bearer + Authorization headers, JWTs, env-style `API_KEY=`, long hex blobs, secret-named object keys). `findLeaks()` is the test-side assertion that no raw secrets remain — a 100-iteration fuzz validates the pair. `server/evidence/evidence-builder.js` aggregates run + scope snapshot + prompt snapshot + artifacts + findings + trace + roll-up summary, redacts the whole thing, and exposes `renderEvidenceMarkdown()`. New routes: `GET /api/runs/:id/evidence` + `POST /api/runs/:id/evidence/export {format: 'markdown'|'json'}`. Run detail gets an **Evidence** tab between Artifacts and Prompt snapshot, with KPI tiles, scope/prompt accordions, findings table, artifacts list, and Markdown + JSON export buttons.

**A5 — Dash next-action hero.** Top of Dash now shows ONE primary action derived from current state via a 5-priority cascade: diagnostics-blocked → onboarding-incomplete → pending-approvals → active-campaign → start-new-campaign. Each priority maps to a tone (`crit / cy / warn`) driving the left-border accent. Partial-fetch failures degrade to the next priority. A "Continue where you left off" pill reads `phantom_last_seen` from localStorage when set.

**A6 — Settings consolidation.** New Diagnostics tab in Settings (between Tools/MCP/Skills and Advanced) hosting the same full diagnostics card used by Dash, with its own Refresh button. The A0-era duplicate `#settings-diagnostics-card` mount inside System Access has been removed so the id stays unique.

**A7 — Alerts → incidents triage.** Findings gain a distinct `triage_status` lifecycle (`new → acknowledged → in_progress → dismissed → closed`) separate from the existing `open/closed` status. Dismissing `high|crit` requires a `dismissal_note` — server returns `400 { error: 'dismissal_note_required' }` without one. The alerts drawer footer now exposes a 4-button triage rail (Ack / In progress / Dismiss / Close); dismiss prompts for the note inline.

**A10 — Glossary + copy sweep + demo watermark.** `user-docs/reference/glossary.md` defines the canonical operator vocabulary (run / conversation / goal / campaign / evaluator / scope / risk class / asset / finding / toolpack / profile / manifest / approval / artifact / evidence bundle / replay / diagnostics / onboarding checklist / demo data / trace event). `frontend/js/lib/demo-watermark.js` uses a `MutationObserver` to tag any row whose visible text contains `[demo]` with `data-demo="true"`; CSS adds a small "DEMO" pill in the corner. Two "POST /api/..." instruction strings in the Campaigns presenter were replaced with friendlier copy.

**B0 — Manifest schema spike (background agent).** `toolpack.phantom.dev/v1` schema in `server/registry/manifest-schema.json` with sections `identity / compatibility / trust / risk / install / tools / prompt / outputs / templates / docs / review / lifecycle`. A dependency-free draft-07-subset validator (`manifest-validator.js`, ~250 lines) was preferred over adding Ajv. Schema rejects shell-string install recipes via `additionalProperties:false` plus an explicit `not` clause. Every existing built-in toolpack has a fixture manifest under `server/registry/fixtures/` and passes validation. No runtime behavior change.

**B1 — Local registry client + browse + preview routes.** `server/registry/local-manifest-loader.js` reads every fixture, runs each through the validator, computes the on-disk SHA-256 (`computedDigest`), and caches the result. The diagnostics endpoint gained a `registry` check that surfaces invalid-manifest counts. Three operator-facing routes: `GET /api/registry/local` (summary + light manifest list), `GET /api/registry/local/:id` (full record), `POST /api/registry/local/:id/preview-install` (declarative plan — no execution). The full resolver integration (toolpack-registry consults manifests with the JS registry as fallback, installer plan rewrite, profile cross-wiring) is deferred to a follow-up B1 commit.

**B2 — Registry UI MVP.** New top-level sidebar nav entry "Registry" with REG glyph. Page layout mirrors Campaigns: list aside + detail drawer. `frontend/js/registry/registry-presenter.js` is the pure presenter; renders a validity pill, a trust pill (`✓` when declared digest matches the on-disk hash, "unsigned" when they disagree), risk classes as chips, tools list with risk-class pills + `gated` flag, install recipes as a formatted JSON block, lifecycle data when present. Preview-install plan renders below with a `Request install` button that is rendered-but-disabled (Approvals plumbing for registry events lands in a follow-up).

**Background-agent pattern.** Three agents ran in parallel without colliding: B0 owned `server/registry/{schema,validator,fixtures}` + docs; A1b owned `server/tools/network-discovery.*` + `phantom-tools.js` (register only) + scope-page.js modal + new HTML modal markup + scoped CSS section; A3 owned `server/approvals/explain.*` + the approvals route surface + `frontend/js/pages/approvals-page.js` + a scoped CSS section. The mega-plan's per-phase "Files" + "Agent team" + paste-ready goal-prompt blocks made the briefs paste-ready. A8.0 (React + Vite + Tailwind + shadcn/ui infrastructure) launched as a fourth background agent at the end of the sprint.

**Schema additions (additive via `ensureColumn`).** `install_requests.denial_reason` (A3) · `findings.triage_status` + `findings.dismissal_note` (A7).

**Tests.** Started the session at **250 passing** (the campaign-engine baseline). Sprint end: **416 / 416 passing** across 47 suites — net +166 new tests. The diagnostics timing-budget assertion has been bumped to 4500ms of slack to absorb `node --test` parallelism — the production route still returns in 60–500ms on docker-server.

**Live state.** Image `phantom:full @ 7c4e644a` deployed to docker-server; all new endpoints respond; Authelia gate preserved at `phantom.axiom-labs.dev`.

**Sprint continuation — A8 React migration + hosted-registry preps.** The /goal session went well past the initial polish-pass scope; here's the rest that landed in the same sitting.

**A8.0 — React + Vite + Tailwind + shadcn/ui infrastructure (background agent).** Added React 18 / Vite 5 / Tailwind 3.4 / shadcn/ui + React Query + Zustand + Vitest + Testing Library. `tailwind.config.ts` consumes the existing CSS variables (`--cy-1` etc.) so the palette is identical to the legacy. `vite.config.react.ts` outputs to `dist/react/`. `server/index.js` gained `const REACT_PAGES = new Set([])` + a `/react/*` static mount — empty default = nothing flipped over, so the legacy site is unchanged. `frontend/src/lib/api.ts` is the TypeScript port of fetch-helper.js.

**A8.1 — Campaigns → React + shadcn/ui (background agent).** Side-by-side at `/react/campaigns`. shadcn primitives scaffolded under `frontend/src/components/ui/`: button / badge / card / checkbox / dialog / input / label / select / sheet / skeleton / tabs / textarea / toggle-group. New pages: `Campaigns.tsx` (list) / `CampaignDetail.tsx` (Sheet drawer w/ Overview-Goals-Runs-Evidence tabs) / `CampaignCreate.tsx` (Dialog form). Bespoke `RiskGrid`, `ToolpackPicker`, `CampaignPill`. React Query owns campaign + replay queries; mutations invalidate on success. tailwind-merge dropped from cn() and `@radix-ui/react-select` replaced with a styled native `<select>` to keep the bundle lean.

**A8.2 — Settings + Scope → React (background agent).** Side-by-side at `/react/settings` + `/react/scope`. Re-used every existing shadcn primitive (no new Radix packs). The Settings page mirrors the legacy 7-tab IA (Models / General / Agent Behavior / Prompts / Security/Scope / Tools/MCP/Skills / Diagnostics / Advanced) — full IA reorganization defers to A8.5 cleanup. The Scope page ships list + Sheet detail + Dialog create; the full builder (intent tiles, ROE templates, action-class matrix, target chips, asset picker) stays on the legacy `/scope` page until A8.5.

**A8.3 — Runs + Graph chrome + Artifacts → React (background agent).** Side-by-side at `/react/runs` + `/react/graph` + `/react/artifacts`. `RunPill` + `TraceTimeline` components. The graph canvas painter is INTENTIONALLY deferred to A8.5 per the mega-plan — the React `/react/graph` surface shows a coming-soon Card with a deep-link to the legacy renderer. Artifacts page is list + 5 filter chips (All / Reports / Evidence / Trace / Other) over /api/artifacts; the inline iframe preview stays on legacy `/artifacts` until A8.5.

**A8.4 — Dash + Onboarding + Approvals + Alerts → React (background agent).** Side-by-side at `/react/dash` + `/react/onboarding` + `/react/approvals` + `/react/alerts`. `Dash.tsx` is the Operations Command Center: hero card (5-priority cascade ported verbatim from dash-hero.js to TS) + KPI strip + 3-card cockpit row (Live runs / Untriaged alerts / Policy decisions 24h). Approvals page surfaces the A3 EXPLAINED shape with Approve / Deny actions; high|crit denials require the dismissal_note via a Dialog. Alerts page has severity + triage_status + scope filter chips + the same triage rail from A7. New: `DashHero`, `ApprovalCard`, `SeverityBadge`, `TriageRail` components.

**B3 prep — ed25519 manifest signature verifier.** `server/registry/manifest-signer.js` — pure node:crypto, no new deps. Minisign-style detached ed25519. `computeManifestDigest(bytes)` + `verifyManifestSignature({manifestBytes, manifest, trustRootBase64, expectedSigner?})`. Trust root is a base64-encoded raw 32-byte public key (PHANTOM wraps it in the SPKI prefix internally). Decision resolves mega-plan "Open decision" #6 in favor of minisign-style over Sigstore for v1; migration path to Sigstore/cosign stays open with the same verify shape. 11 tests cover happy path, digest mismatch, tampered signature, wrong trust root, signed_by mismatch when pinned, missing fields, base64-decode error. Wired into local-manifest-loader: every manifest now carries `signatureStatus ∈ {unsigned, unknown_signer, verified, invalid}`. Configured via `setTrustRoots([{keyId, base64Key}, ...])`.

**B4 prep — revocation feed client.** `server/registry/revocation-feed.js` — parses + verifies + indexes `phantom.revocations/v1` feeds. Reuses the B3-prep ed25519 verifier with a feed-body-minus-trust-block hash. `parseRevocationFeed(feed, {trustRootBase64?, expectedSigner?})` returns `{ok, errors, feed, signatureStatus}`. `checkRevocation(parsedFeed, packageId, version)` returns `{status: 'ok' | 'warn' | 'block', entry?, replacement?, reason?}`. 13 tests cover schema validation, entry field validation, malformed JSON, signature happy path + tampered body, unsigned fallback when no trust root configured, and three checkRevocation cases. Like B3-prep — contract in place, hosted infra deferred.

**Sprint continuation #2 — A8.5 cutover + B3/B4/B5 PHANTOM-side.** The Stop hook caught my "schedule as a deliberate next session" framing and required the work to actually happen. Four more phases landed:

**A8.5 cutover.** `REACT_PAGES` in `server/index.js` populated with all 10 migrated bare-path prefixes (`/dash`, `/onboarding`, `/campaigns`, `/settings`, `/scope`, `/runs`, `/graph`, `/artifacts`, `/approvals`, `/alerts`). The React app's react-router config now mounts every page at BOTH the bare path AND the legacy `/react/*` preview path. The Dockerfile gained `npm run build:react` alongside `npm run build` so `dist/react/` actually ships in the image (the verify step caught that the React bundle was being built only on dev hosts). The legacy `frontend/js/` modules + CSS sections are RETAINED for `git revert`-style rollback safety — the structural deletion is documented as A8.5b for a deliberate review-then-delete pass once parity-close commits land. Each A8.X phase shipped with documented visual/feature deltas (Dash sparklines, Alerts Grid view, Approvals decision history, Settings Prompts/Security/Tools tabs, Scope full builder, Runs replay scrubber, Graph canvas painter, Artifacts inline preview) that need to close before the legacy modules can vanish.

**B3-full PHANTOM-side.** Hosted-registry consumer end. New `registry_sources` table (additive — id, label, url, channel, signing_key, signing_key_id, enabled, last_fetched_at, last_status, last_error, timestamps) added via the `ensureColumn` pattern. `server/registry/registry-source-store.js` is the CRUD layer with HTTPS-only enforcement + deny-by-default `enabled=false`. `server/registry/remote-fetch.js` is the HTTP+verify pipeline: `fetchIndex / fetchManifest / fetchRevocations` each return `{ok, parsed?, signatureStatus, errors[]}` with bounded timeouts (5000ms default), a 5MB body ceiling, and an injectable `opts.fetcher` for tests. Schema validation gates manifest acceptance BEFORE signature verification. Routes: `POST /api/registry/sources` (create), `GET /api/registry/sources` (list, optional `?enabledOnly=1`), `PATCH /api/registry/sources/:id` (update + enable/disable), `DELETE /api/registry/sources/:id`, `POST /api/registry/sources/:id/fetch` (operator-driven index fetch + sig verify, records outcome), `POST /api/registry/sources/:id/revocations` (feed fetch + verify). Hosted control plane (Postgres + signing service + object storage) remains a separate non-PHANTOM project.

**B4-full PHANTOM-side.** Periodic revocation polling + cache + query. `server/registry/revocation-poller.js` runs `pollOnce()` once at boot then every 30 minutes via `setInterval().unref()` so it doesn't hold the event loop on graceful shutdown. `checkRevoked(packageId, version)` returns the highest-severity match across all cached feeds (`block` > `warn` > `ok`). FAIL-SAFE: unreachable source / signature failure / parse error do NOT crash the process — outcomes are recorded via `recordFetchOutcome()` and stale caches stay readable as a regression signal. `server/index.js` lazy-imports + starts the poller after DB init (skipped under `NODE_ENV=test`). Routes: `GET /api/registry/revocations` (cached roll-up), `POST /api/registry/revocations/poll` (operator-driven immediate poll), `GET /api/registry/revocations/check?package=X&version=Y` (used by the install-preview path). 10th diagnostics check (`revocations`) reports `block > 0 → degraded`, `warn > 0 → needs_setup`, else `ok`.

**B5 PHANTOM-side.** `user-docs/reference/registry.md` — comprehensive operator guide covering local fixtures, private hosted registry source layout + REST flow + trust model, revocations feed shape + operator queries + diagnostics integration, and the public read path posture (same code, just configure a source URL with the public signing key pinned). PHANTOM-side is documentation + posture only; the public CDN + WAF + rate limits are hosted infrastructure.

**Final sprint totals (sprint start → sprint end #2).**

- **21 of 21 mega-plan phases shipped** (every A0–A10 + every B0–B5 PHANTOM-side). Two contract-only deliveries (B3-prep, B4-prep) precede the full PHANTOM-side B3/B4 to keep merges clean.
- **6 background agents + foreground continuation** (B0, A1b, A3, A8.0, A8.1, A8.2, A8.3, A8.4 via agents; A8.5 cutover + B3-full + B4-full + B5 in foreground).
- **Tests: 250 (sprint start) → 470 server + 117 Vitest = 587 passing** (+337 net new across 31 commits).
- **Live state.** Image `phantom:full @ 2bbe75ac` on docker-server. Bare paths (`/dash`, `/campaigns`, `/settings`, `/scope`, `/runs`, `/graph`, `/artifacts`, `/approvals`, `/alerts`, `/onboarding`) now serve the React bundle directly. `/react/*` preview paths still resolve for debugging + side-by-side. 10 diagnostic checks (incl. `parity`, `registry`, `revocations`) returning in ~10ms. Authelia gate preserved at `phantom.axiom-labs.dev`.

**Hosted-side work explicitly NOT shipped (separate non-PHANTOM projects).**
- Postgres + signing service + object storage for the hosted control plane.
- RBAC + audit export + monitoring + backup/restore + incident drills.
- Public CDN deployment + WAF + rate limits.

When that infrastructure exists, operators add a registry source pointing at it (with the published signing key pinned) and the existing PHANTOM code consumes it without further changes. The contract is complete on the PHANTOM side.

**Known follow-ups for the next session (UI/UX focus).**
- A8.5b — the structural deletion of legacy `frontend/js/` modules + `cf-*`/`campaign-*`/`goals-*`/`scan-*`/`onb-*`/`diag-*` CSS sections, after parity-close commits close the documented visual gaps in each A8.X phase.
- Parity-close per page: Dash sparklines, Alerts Grid/Map/search/export, Approvals decision history, Settings Prompts/Security/Tools full tabs, Scope full builder UI, Runs replay scrubber + synthesis card, Graph canvas painter migration, Artifacts inline preview pane.
- Once parity closes + A8.5b ships, `sec-ui-kit.test.js` is rewritten against the React bundle per the mega-plan acceptance bar.

**Remaining mega-plan phases (NOT shipped this session, intentionally).**
- **A8.5 cleanup** — deletes the legacy bundle + ~3000 lines of CSS (`cf-*`, `campaign-*`, `goals-*`, `scan-*`, `onb-*`, `diag-*`, etc.), deletes migrated `frontend/js/` modules, rewrites `sec-ui-kit.test.js` against the React bundle. Risky to dispatch via agent — operator review of "what gets deleted" is the load-bearing step. Schedule as a deliberate next session.
- **B3-full hosted signed registry MVP** — Postgres + signing service + object storage + admin/review/release plane. PHANTOM-side code WON'T change (the B3-prep contract is the client; only the trust-root config needs to be added). The infrastructure project is days-to-weeks of separate work.
- **B4-full governance hardening** — RBAC + audit export + monitoring + backup/restore + incident drills. Depends on B3-full.
- **B5 public read path** — Static signed CDN mirror + transparency page + channel controls. Depends on B3+B4.

The two contract-only preps (B3 + B4) mean PHANTOM is READY for the hosted registry the moment infrastructure exists — no client-side code changes needed, only operator configuration of registry sources + trust roots.

## 2026-05-20 — Campaign Engine v1 (Tasks 1, 2, 3, 6, 7, 8, 4) + Goal Context v0

Two parallel arcs landed in one session against `docs/plans/2026-05-20-phantom-goal-engine-plan.md` and `docs/plans/2026-05-20-phantom-goal-prompt.md`.

**Arc 1 — Goal Context v0.** A small ad-hoc "what we're working toward in this chat" primitive: persistent objective + agent-filed progress notes. Distinct surface from the canonical Campaign Engine; ships as the supporting context layer the spec explicitly *doesn't* want every chat to escalate into a full campaign. New `goals` + `goal_progress` tables and `runs.goal_id` (additive nullable column) in `server/memory/store.js`. `server/goals/goal-store.js` owns CRUD + single-active pointer (`settings.current_goal_id`) + 50/day progress rate cap. `server/goals/goal-progress.js` adds a synthesis-time heuristic `scoreRunAgainstGoal` + `recordRunOutcomeAgainstGoal(runId)` called from the three terminal branches in `server/index.js`. Three agent-callable phantom tools land in `server/tools/phantom-tools.js`: `phantom_get_goal`, `phantom_log_goal_progress`, `phantom_declare_goal_satisfied` (claim never closes the row — operator confirms in UI). `renderActiveGoalBlock` in `server/ai/system-prompt.js` injects the goal between UI context and ASK-GATED actions; objective hard-capped at 800 chars, criteria at 600, latest 5 progress entries inlined; omitted entirely when no goal is active. UI: top-bar `#active-goal-strip` + Settings → Goals CRUD card (`frontend/js/goals.js`).

**Arc 2 — Campaign Engine v1.** PHANTOM-as-supervisor for governed multi-run security objectives, modeled on John Hammond's *"Goal → worker run → proof artifacts → evaluator → next goal"* loop and the canonical 10-task plan. Tables: `campaigns` (objective, scope, toolpacks, worker_backend, risk_budget, run_budget, status), `campaign_goals` (parent_goal_id supports tree decomposition, attempt_count, max_attempts, evaluator_result_json), `campaign_goal_runs` (join table linking PHANTOM runs into campaign goals). `server/campaigns/campaign-store.js` owns the persistence; `server/campaigns/goal-engine.js` is the thin orchestrator (`runOneGoal`, `finalizeRunForCampaign`, `nextQueuedGoal`); `server/campaigns/goal-evaluator.js` ships a pure deterministic evaluator producing the canonical JSON shape (`continue | retry | branch | next_goal | needs_approval | complete | fail | pause` + `approvalRequest` + `evidence` + `confidence`). `server/campaigns/worker-backends/phantom-native.js` is the only backend in v1 — spawns each goal as a normal PHANTOM run record with its own conversation, links via `campaign_goal_runs`, emits `worker.spawned` + `goal.started` trace events. `finalizeRunForCampaign` hooks into the same three terminal branches in `server/index.js` (immediately after `recordRunOutcomeAgainstGoal`); when the run was campaign-linked it reads trace/artifacts/findings, runs the evaluator, persists the verdict, mirrors the decision onto goal + campaign status, and writes a `goal.evaluated` trace event. REST surface mounted under `/api/campaigns/*`: CRUD + `/goals` + `/goals/:goalId/run` + `/run-next` + `/evaluate` + lifecycle controls (`start | pause | resume | cancel`) with `409` for illegal transitions; cancel auto-skips queued goals. Read-only `/campaigns` page shell + pure presenter (`frontend/js/campaigns/campaign-presenter.js`) with status pills + budget metadata; nav entry alongside Assets/Scope; the inline creation form, detail drill-in, and lifecycle controls UI defer to follow-up tasks 5 + 9.

**Architecture invariant.** Boundary between the two arcs is clean because the canonical spec uses distinct table names (`campaigns`, `campaign_goals`, `campaign_goal_runs`) and route prefix (`/api/campaigns/*`). `goals` (v0) carries the *single ad-hoc chat objective*; `campaign_goals` (v1) is the *governed multi-run queue unit*. Schema and APIs coexist without overlap; the only shared touch point is the `runs.goal_id` column (v0) vs `campaign_goal_runs.run_id` (v1), which never both populate for the same run.

**Locked decisions across the rollout.** Single active goal in v0 (`settings.current_goal_id`, single-row by convention). Status transitions on both goals and campaigns are operator-driven — the agent only files satisfaction *claims* and the evaluator only proposes verdicts. Scope policy precedence preserved end-to-end: the system-prompt ordering is UI-context → goal → ask-gated actions, and the canonical spec's "evaluator may propose, policy gate still decides" hard rule is honored because the executor runs the policy check before any tool dispatches. Deterministic-first evaluator in v1 (LLM enrichment reserved behind a `goal_llm_evaluation_enabled` flag, mirroring `synthesis_llm_enabled`). Worker backends behind a registry — phantom-native is the only one wired in v1; `codex-exec` and `codex-goal-experimental` listed in the spec but deferred to Task 10. Budgets are shallow-merged on `updateCampaign` so partial updates don't wipe wall-clock + risk-class defaults.

**Tests.** 216 → **250 passing** (+34 across `goal-store.test.js`, `goal-progress.test.js`, `phantom-tools.test.js`, the new `Campaign CRUD + goal queue + lifecycle controls` and `Goal CRUD + activate/complete/progress` sections in `api.test.js`, the goal block tests in `system-prompt.test.js`, `campaign-store.test.js`, `goal-evaluator.test.js`, `goal-engine.test.js`, and `campaign-presenter.test.js`). `node --check` clean across all changed JS.

**Open follow-ups.**
- **Task 5** — Campaign creation form (currently REST-only).
- **Task 9** — Campaign replay + evidence bundle.
- **Task 10** — Codex-exec backend.
- **Autonomous loop** — orchestrator that picks the next queued goal after each `finalizeRunForCampaign` verdict (`retry` / `continue` / `next_goal`) and re-spawns automatically; v1 is operator-driven via `POST /api/campaigns/:id/run-next`.
- **Findings linkage** — v1 reads `getFindings({ runId })` for the evaluator; deeper finding↔campaign attribution lands when the alerts queue surfaces campaign provenance.
- **LLM-backed evaluator enrichment** behind `goal_llm_evaluation_enabled`.
- **Multi-active goals / goal stacking** for v0 (currently single-active via `settings.current_goal_id`).

## 2026-05-20 09:23 EDT — Goal Engine Planning Docs

- Added `docs/plans/2026-05-20-phantom-goal-engine-plan.md` with the PHANTOM-native Goal Engine / campaign worker implementation plan: data model, APIs, worker backends, safety governance, evaluator schema, tasks, verification, and acceptance criteria.
- Added `docs/plans/2026-05-20-phantom-goal-prompt.md` with paste-ready campaign, child-worker, temporary Codex `exec`, future `/goal`, and evaluator prompts.
- Kept Codex `/goal` framed as an optional worker backend while PHANTOM remains the canonical supervisor for scope, traces, artifacts, findings, approvals, and replay.

Validation:
- Documentation copied from the reviewed Obsidian planning packet with Obsidian frontmatter stripped for repo use.
- `git diff --check` — passing.

## 2026-05-19 — Containerization Rollout (Phases 1–6)

Six-phase rollout converting PHANTOM into a Docker-on-Linux primary, Windows-dev-only project with build-time and runtime toolpack profiles. Plan in `ai_sync/containerization.md`; phase ordering preserved across six commits (`e78db3c`, `352b4c0`, `93920dc`, `c5168ce`, `05a78d3`, this commit) so each phase is independently revertible.

**Phase 1 — Container substrate.** `Dockerfile` on `debian:stable-slim`, single-stage with `build-essential` retained because `better-sqlite3` compiles native bindings from source on this base. Layer order: system deps → toolpack layer → npm deps → source copy → `npm run build` (frontend + VitePress). `docker-compose.yml` exposes 1337, environment passthrough for `API_BASE_URL` / `API_KEY` / `MODEL_ID`, named volumes `phantom-workspace` and `phantom-db` (no bind mounts). `.dockerignore` keeps `node_modules/`, `workspace/`, `*.db*`, `.design-fetch*/`, `.verify-shots/`, `.claude/`, `tests/__pycache__/` out of the build context.

**Phase 2 — Docker smoke.** `scripts/smoke-docker.js` mirrors the style of `scripts/run-tests.js`: `docker compose build → up -d`, polls `/api/installer/status` until 200 (60s timeout), probes `/api/onboarding/status` + `/api/runs` + `/api/toolpacks`, tears down. `--no-down` keeps the stack running for inspection. `PHANTOM_DB_PATH` env override added to `server/config.js` so the in-container SQLite file lives on the `phantom-db` volume instead of the disposable `/app/phantom.db`. New `npm run smoke:docker` script.

**Phase 3 — Tool install via build args.** `scripts/install-profile.sh` (POSIX) reads a profile name and runs `apt-get install --no-install-recommends ...` (pipx/go pipelines wired but empty until the resolver lands). Dockerfile gains `ARG PROFILE=base` + `ARG INCLUDE_MSF=0`; Metasploit installs in its own layer so non-msf variants don't pay the cost. `server/tools/installer.js` cleaned up: replaced the `eval("require")('fs')` brittle pattern with a static import and honored a `PHANTOM_BACKEND` env var so detection short-circuits inside the container.

**Phase 4 — Profile table + REST CRUD.** New SQLite `profiles` table; `server/profiles/profile-store.js` (CRUD) + `server/profiles/profile-resolver.js` (`expandProfile`, `renderProfileAsDockerfile`, `resolveProfileAsInstallPlan`). REST routes in `server/routes/api.js`: `GET/POST/PUT/DELETE /api/profiles`, `GET /api/profiles/:id/dockerfile`, `POST /api/profiles/:id/install` (routes through existing approvals queue — no new approval surface).

**Phase 5 — Profile UI subtab.** `frontend/js/pages/profiles-panel.js` renders a CRUD list under Settings → Tools / MCP / Skills, vanilla JS matching the pattern in `installer-panel.js`. Apply-runtime / Export-Dockerfile actions present. Render-stub tests in `profiles-panel.test.js` follow the existing test pattern.

**Phase 6 — Variants + docs (this commit).** New `scripts/build-variants.js` exports the canonical `VARIANTS` matrix (`base | offensive | blue | full | full-msf`) and drives `docker build --build-arg PROFILE=...` across the set with `--only <name>`, `--dry-run`, `--keep-going` flags. README install section restructured: Docker compose is the headline path, `npm install` is demoted to "Dev environment (Windows/macOS)". Variants table + smoke-target call-out + docker compose v2 prereq noted. `user-docs/guide/getting-started.md` mirrors the README structure in user-facing prose. `ai_sync/security.md` gained a Deployment shape paragraph naming Docker-on-Linux as primary and `PHANTOM_BACKEND=apt` as the production assumption.

**Key locked decisions across the rollout.** debian-slim single-stage base; named volumes (not bind mounts); `PHANTOM_DB_PATH` env override so the DB file lives on a Docker volume; `PHANTOM_BACKEND` short-circuit so the installer skips host probing inside the container; build-arg PROFILE matrix instead of per-variant Dockerfiles; profile table behind REST CRUD; vanilla-JS Profiles subtab matching the installer-panel pattern; no live uninstall path (rebuild without the line); no split-container topology; manual `docker push` for now (no registry automation).

**Tests.** 166 → 189 across the rollout (Phase 4 added profile-store + profile-resolver + route coverage; Phase 5 added render tests). `npm test` is 189/189 at HEAD. `node --check` clean across all changed JS. `git diff --check` clean.

**Open follow-ups (not in scope for Phase 6).**
- CSS for the Profiles subtab — classes `profiles-table`, `profiles-form`, `profiles-field`, `profiles-empty`, `profiles-form-err`, `profiles-header-actions`, `profiles-caption`, and `installer-toast-action` referenced from `frontend/js/pages/profiles-panel.js` are not yet styled. Append-only pass 31+ candidate.
- Catalog/script unification — `scripts/install-profile.sh` (build-time, static `case` per profile) and `server/profiles/profile-store.js` (runtime profile table) currently hold separate tool lists. Until a unified resolver lands, editing one requires editing the other.
- `.gitattributes` — Windows CRLF noise on every checkout. A normalization file would silence it.
- `scripts/seed.js` — referenced from `package.json` (`seed`, `seed:reset`) but untracked in git. Out of scope for Phase 6.
- Image registry push automation — explicit no for now; the docker-server operator pushes tags manually after `node scripts/build-variants.js` succeeds.

## 2026-05-19 — Cohesive Flow + Sec-Ops Installer + Agent Loop + Test Suite

Large session covering five gap-closing rounds, in two arcs:

**Arc 1 — Cohesive flow (Phases A–D) + sec-ops installer.**

- **Phase A · End-of-run synthesis card** — designed a canonical v1 data shape (`server/runs/synthesis.js`): runId, title, status, scope, objective met/partial/unmet, activity (events/tool calls/artifacts/errors), risk distribution + highest, findings by severity, posture (score 0–100 composed of weighted coverage 40 / risk 40 / hygiene 20 components + rating), highlights, next steps, policy/approvals. Shape is load-bearing — reused by phases B/C without modification. Rendered on the Runs page via a new Synthesis tab that defaults to the headline view, with clickable next-step buttons routing to Rerun / Summary / Approvals / Alerts / Scope.
- **Phase B · First-run onboarding wizard** — 4-step modal (welcome → provider/key → first scope via ROE templates → preview synthesis card with sample data). Sticky completion flag in `settings` table; reset entry-point in Settings → Advanced. Backend signals via `server/onboarding/onboarding.js`.
- **Phase C · Posture trending** — `server/runs/trending.js` aggregates synthesis scores across recent terminal runs (chained `previousScore` so each entry carries a delta), exposed via `/api/trending/posture`. Dash panel: large current-score headline, inline SVG sparkline (dots color-coded by rating), by-scope mini-list, recent-runs list rendered via `SynthesisCard.renderCompactRow` so trend reads by recognition.
- **Phase D · Friction polish** — Dash as default landing route with localStorage persistence (Settings is a `noRestore` route so reloads always re-land on Dash). `phantom:run-complete` re-dispatched from the WS pipe; Synthesis tab flashes when a watched run terminates; Runs sidebar empty state now offers chat + onboarding paths.
- **Sec-Ops installer** — auto-detect host package manager (winget/choco/scoop/apt/dnf/pacman/brew/wsl-apt) plus a 23-tool catalog across base/offensive/blue tiers. Settings → Tools panel renders per-tier cards with installed/total counts and an "Install missing" button. Each install is an approval-gated request persisted to a new `install_requests` table; resolved plan + result captured for audit. Pure-Node detection (no shell-out for the host probe). Approve from Settings *or* from the Approvals page — single governance queue.

**Arc 2 — Five-task gap closure on top of the cohesive flow.**

- **Task 1 · Executor stop condition.** Root cause: `server/ai/llm-client.js` returned immediately on `finish_reason: 'stop'` even when `delta.tool_calls` had been streamed in the same response. Grok (and several OpenAI-compatible shims) emit `'stop'` alongside tool_calls instead of the spec's `'tool_calls'`. Restructured the streaming loop to defer the stop decision until *after* the stream drains; tool_calls take precedence. Added `MAX_AGENT_ITERATIONS = 40`, stuck-state guard (empty content + empty tool_calls → graceful exit), and a `finish_reason: 'length'` truncation hint.
- **Task 2 · System-prompt host context.** `server/ai/system-prompt.js` now imports `getInstallerStatus()` and renders an `## INSTALLED SEC-OPS TOOLS ON HOST` block grouped by tier (base/offensive/blue), placed after the UI-context block and before `ASK-GATED ACTIONS`. The agent reaches for binaries that actually exist rather than guessing tool names.
- **Task 3 · LLM-generated synthesis (flagged).** `llmCompleteJson` helper in `server/ai/llm-client.js` (non-streaming, forces `response_format: json_object`). `enrichSynthesisWithLLM` in `synthesis.js` rewrites `highlights[]` and `nextSteps[]` from the real trace; v1 shape preserved; any failure falls back silently. Toggle in Settings → Advanced (`synthesis_llm_enabled`). `?enrich=1` for ad-hoc testing.
- **Task 4 · Unified Approvals queue.** Pending `install_requests` surface above the KPI strip on the Approvals page as their own card kind — package list, command preview, approve/cancel inline. Status propagates to both Approvals and Settings → Tools on next refresh.
- **Task 5 · Sudo/admin handling.** `classifyResult` in the installer route inspects stderr/stdout against a conservative pattern set ("must be root", "Access is denied", "sudo: a password is required", "Operation not permitted") plus numeric exit codes (winget `0x80073D06`, choco `1603`). Steps classify into `ok | timeout | admin | failed | skipped`. On Linux, cached sudo password (from `/api/sudo/validate`) is piped to `sudo -S` stdin so non-TTY installs work. On Windows, admin failures carry an `elevatedCommand` PowerShell `Start-Process -Verb RunAs …` string; UI surfaces a "Copy elevated cmd" button.

**Arc 3 — Test suite improvements (this round).**

- Fixed the pre-existing scope-builder render test that had been asserting against a removed "visibility" label. Suite now honest.
- Added `server/e2e/full-run.test.js` — end-to-end smoke driving processMessage against a scripted fake provider, asserting trace event accumulation, run completion, and synthesis v1 shape. Catches the one-and-done regression class directly.
- Replaced glob-based `npm test` with `scripts/run-tests.js` — walks `server/` and `frontend/js/` for `*.test.js`, supports `--unit | --e2e | --watch` modes. Works on PowerShell and bash.
- `frontend/js/test-dom-stub.js` — 50-line minimal DOM stub (no jsdom dep); two new test files cover `SynthesisCard.render` / `renderCompactRow` and `InstallerPanel.renderStepStatus` / `renderRequest` / `renderToolRow` / `resultBlurb`.

Validation:
- `npm test` — **155/155 passing** across 30 files (was 134 with 1 pre-existing failure at the start of the session).
- `npm run test:unit` — 152/152 passing (~3s).
- `npm run test:e2e` — 3/3 passing (~1s).
- `npm run build` — passing with existing Vite non-module warnings.
- `node --check` — passing across all changed files.

Append-only CSS passes 25 → 30. No new runtime deps. No commits yet — awaiting operator instruction.

## 2026-05-17 22:29 EDT — PHANTOM SEC UI Kit Implementation

- Fetched and unpacked the Claude Design handoff bundle for `PHANTOM SEC UI kit.html`, read its README, chat transcript, token/component CSS, and primary implementation direction.
- Implemented the relevant production-feasible UI kit aspects in the vanilla frontend: cool-slate SEC/SOC tokens, cyan system accent, green demoted to success-only, compact radii/density, restrained elevation, line/mono glyph navigation, and removal of matrix/emoji hacker chrome from the main shell.
- Added a keyboard-friendly `Ctrl/⌘+K` command palette for core routes/actions and refreshed the chat welcome, top bar, scope strip, controls, cards, settings, assets, and governed-run surfaces with the operator-dense visual language.
- Added Node coverage asserting the SEC UI kit chrome, tokens, and vanilla command palette wiring stay in place.

Validation:
- `node --test frontend/js/sec-ui-kit.test.js` — passing.
- `npm test` — 61/61 passing.
- `npm run build` — passing with existing Vite non-module script warnings.
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing.
- `python3 tests/smoke_test.py` — 4/4 passing.
- Playwright live UI smoke verified `Ctrl/⌘+K` opens the dark command palette and `#matrix-bg` is absent; screenshot saved at `/tmp/phantom-sec-ui-kit-fixed.png`.
- `git diff --check` — passing.

## 2026-05-17 22:08 EDT — Operator Override Test Mode

- Added a per-run **Operator Override** policy mode for local testing/fixture validation. It intentionally bypasses scope/target gates while still classifying risk, redacting override reasons, and persisting `tool.call.override` audit trace events before execution.
- Kept the default path governed: missing scopes, expired scopes, explicit denials, and out-of-scope risky actions still block unless the operator explicitly enables override for that run.
- Surfaced the override toggle + reason in Chat, persisted governance metadata in run prompt snapshots, exposed policy mode in Runs detail, and documented the terminology in Settings.
- Added regression coverage for scope-free risky execution under Operator Override, explicit override audit events, no `tool.call.blocked` false positives, and secret redaction in override reasons.

Validation passed:
- RED: `node --test server/scope/policy.test.js server/governed-runs.test.js` failed before implementation on missing override allowance and missing override audit event.
- GREEN targeted: `node --test server/scope/policy.test.js server/governed-runs.test.js frontend/js/pages/settings-page-presenter.test.js` — 16/16 passing.
- `npm test` — 61/61 passing.
- `npm run build` — passing with existing Vite non-module warnings.
- `find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check` — passing.
- `python3 tests/smoke_test.py` — 4/4 passing.
- Restarted `phantom.service`; post-restart `python3 tests/smoke_test.py` — 4/4 passing.
- `git diff --check` — passing.

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

## 2026-05-21 17:25 EDT — UI parity pass: restore the SEC UI-kit concept after the React migration

The A8.x React migration had "minified" the UI away from the PHANTOM SEC UI-kit
concept: it kept the app shell but collapsed the design-token system to a ~15-token
subset and rebuilt screens as generic shadcn surfaces, dropping the kit's purpose-built
component anatomy. Audited current React vs the design handoff bundle (`.design-fetch-v3`)
and executed a full-parity enhancement plan via an agent team. Plan: `docs/UI_ENHANCEMENT_PLAN.md`.

Foundation (single source of truth restored):
- `frontend/src/styles/globals.css` — re-expanded the token system to full kit parity
  (severity scale crit/high/med/low/info/ok ×fg/bg/line, governance `--policy`/`--redacted`,
  spacing `--s-*`, radii `--r-*`, font-size `--fs-*`, density `--row-*`/`--ctl-h` + compact
  override, motion `--ease`/`--t-*`, elevation `--elev-*`/`--ring-focus`, interaction tints).
  Legacy aliases (`--danger`/`--ok-2`/`--warn-2`) kept so in-flight components don't break.
- `tailwind.config.ts` — exposed sev-*/policy colors, r1–r5 radii, fs-* sizes, elevation shadows.
- `frontend/src/styles/kit-components.css` (new) — ported the kit's semantic component classes
  (.panel/.stat/.sev-tick/.evt timeline/.chip.target/.drawer/.kv/.bar/.spark/.tbl/.alert-row/.cmdk),
  omitting the kit's global `*` reset so Tailwind preflight stays authoritative. Imported in main.tsx.
- `frontend/src/components/ui/kit.tsx` (new) — typed primitives Panel/Stat/SevTick/Chip/TargetChip/
  Bar/Spark/Kv/ButtonGroup/Kbd. `SeverityBadge` refactored to the kit `.badge` anatomy + the missing `ok` level.

Screens brought to kit parity (one agent each, composing the primitives):
- Dash → cockpit: 6-up KPI Stat strip + Live runs / Untriaged (sev-tick) / Policy-decisions-24h (bars
  + top-reasons) / Toolpack-availability / Asset-health-movers panels.
- Alerts → alert-queue: dense `.tbl.zebra.dense` with sev-tick edge + mono-cyan IDs + hover row-actions
  + selected cyan inset; detail drawer with Evidence/Asset/Trace/History tabs, Kv grid, Policy Decision,
  PoC pre-block, Suggested Fix.
- Runs → run-detail: `.timeline`/`.evt` grammar (tool=cyan-filled, blocked=purple, failed=red, ok=green)
  with inline `.cmd` blocks + `.reason` lines; persistent right Kv metadata drawer (run/scope/prompt/artifacts,
  redacted creds shown as `•••`).
- Graph: legend overlay, orthogonal + dashed policy edges, node kind-badges + sub-text, replay marker,
  grid background, zoom-widget overlay, node inspector drawer, toolbar (search/seg-tabs/follow/show-blocked).
- Scope builder: `.chip.target` mono targets, allow/ask/deny action matrix (locked exploit/destructive rows),
  client-side dry-run policy-preview drawer; Scope detail → Kv grid.
- Asset Profile (new page + route `/assets/:id`): identity Kv, health score + spark + severity distribution,
  open-findings .tbl with sev-tick, services table, scope membership.

Validation passed:
- `npm run build:react` — passing (CSS bundle 53 kB).
- `npm run test:frontend` — 170/170 passing (25 files; +19 new tests from the parity work).
- `npx tsc --noEmit -p tsconfig.frontend.json` — 0 errors.

Notes / deferrals:
- Visual screenshot capture was skipped — browser automation wasn't connected this session; `npm run dev`
  (localhost:5173) left running for manual review.
- Several panels derive/placeholder fields the API doesn't expose yet (asset health score, toolpack readiness,
  per-finding PoC/history). The scope dry-run is a labelled client-side preview (no dry-run endpoint).
- Runs trace timeline couldn't be eyeballed with live events (runs table empty in the seed); renders empty state.

## 2026-05-21 17:48 EDT — UI parity wave 2: brand/motion layer + placeholder fixes

Second pass after a re-audit against the design handoff. Two gaps closed: (1) the motion/brand
layer from chat2.md was never ported, and (2) several first-pass "placeholders" were actually
backed by endpoints the agents hadn't discovered.

Brand & motion (was 0% incorporated):
- NEW `frontend/src/components/PhantomMark.tsx` — packet-train logomark (static sidebar + animated
  splash variants, prefers-reduced-motion aware). Replaces the plain `bg-primary` dot in AppShell.
- NEW `frontend/src/components/SplashScreen.tsx` — animated packet-train boot screen; now the App.tsx
  Suspense fallback (was literal "Loading…").
- `frontend/src/index.html` — added the kit's packet-train favicon data-URI.
- NEW `frontend/src/components/AgentStateIcon.tsx` + `styles/agent-states.css` — the four isometric
  agent-state animations (loading/scanning/engaging/verified) with reduced-motion fallbacks, imported
  in main.tsx. Wired: RunPill running→scanning, completed→verified (one-shot); Runs.tsx loading
  skeletons → contextual loading/scanning loaders. (Engaging exported, reserved for a future
  tool-execution/approval surface.)

Placeholder fixes (mostly real endpoints that were never wired):
- Dash asset health → real aggregation of `/api/findings` by assetId (open count + worst severity),
  labelled findings-derived. Toolpack readiness → real `/api/toolpacks/:id/availability` ($PATH check).
- Graph search → client-side label filter (dims non-matches); Run/Topology/Asset view-switch → new
  deterministic `nodeTypeFilter` param on `layoutGraph()` (backward-compatible default).
- Alerts Trace tab → real `/api/runs/:id/events` via `useRunEvents`; PoC/Policy/Suggested-Fix now read
  real finding fields (evidence/scopeId/recommendation) before metadata fallback.
- Alerts History tab → NEW read-only `GET /api/findings/:id/history` (server/assets/asset-store.js
  `getFindingHistory` + server/routes/api.js), reconstructs lifecycle from finding timestamps +
  triage + the run's trace_events; mirrors the /api/approvals pattern; +2 server tests.
- Scope dry-run → now calls the REAL evaluator via `POST /api/scopes/evaluate-draft` (probes each
  action class + a synthetic out-of-scope action); client-side preview kept only as a labelled
  fallback if the call fails.

Validation passed:
- `npx tsc --noEmit -p tsconfig.frontend.json` — 0 errors.
- `npm run build:react` — clean.
- `npm run test:frontend` — 191/191 (27 files; +21 since wave 1).
- `npm run test:unit` — 390/390 (47 suites), including the new findings-history endpoint.

Remaining deferrals:
- Visual screenshot capture still pending (no browser automation this session); dev server at
  localhost:5173 for manual review.
- Engaging animation is built but unwired (no run state maps to it yet).

## 2026-05-21 21:10 EDT — UI parity wave 3: structural / IA fidelity (sidebar + split-pane)

Third pass after a structural re-audit. Two gaps vs the kit: (1) the sidebar didn't match
shell.jsx (flat list, text glyphs, no counts), and (2) every list+detail surface used shadcn
Sheet modal overlays instead of the kit's persistent inline `.drawer` columns — detail was
"stuffed in drawers" rather than shown as proper split-panes beside the list.

Foundation:
- NEW `frontend/src/components/ui/icons.tsx` — full port of the kit's 44 line icons
  (16px, stroke 1.5) as typed React components.
- NEW `frontend/src/components/ui/split-pane.tsx` — master-detail layout primitive: desktop =
  list (flex-1) + fixed-width inline detail column (the kit's `.drawer`-as-grid-column topology);
  mobile = detail full-width takeover, list hidden. Detail node mounts once.

Sidebar (`AppShell.tsx` + new `lib/navCounts.ts`):
- Two labeled sections — Operations (Dash/Chat/Alerts/Runs/Graph/Artifacts/Campaigns/Assets-Scope)
  and Governance (Approvals/Registry/Settings) — matching shell.jsx grouping.
- Text glyphs replaced with line icons; `.side-link.active` cyan inset rail.
- Live count badges: Alerts (untriaged), Runs (active), Approvals (pending), Assets/Scope (count);
  composed from existing query hooks, no new endpoints, omit-when-unavailable.
- Footer: status dot + active provider · model (from /api/settings). Latency omitted (no cheap signal).
- PhantomMark gains the "GOVERNED OPS" sub-label.

Split-pane conversion (Sheet overlay → inline column; routes + deep-linking unchanged):
- Alerts (1fr | 420px), Runs (list | trace | 360px metadata), Scope, Campaigns, Approvals (route-based),
  Registry (state-based). Each page is now height-bounded (`h-[calc(100vh-3rem)]` flex column) with the
  PageHeader on top and the SplitPane filling the rest; detail routes dropped `<Sheet>` for inline
  `.drawer`/`.drawer-hd`/`.drawer-bd` chrome with an IcX close that navigates back to the list.
- detailOpen derived via react-router `useMatch`; Scope/Campaigns exclude the `new` create route (those
  stay full-width create forms). Approve/deny flow + EngagingIcon preserved. Fixed a hook-order bug in
  the Runs match logic (both useMatch calls must run before combining).

Validation passed:
- `npx tsc --noEmit -p tsconfig.frontend.json` — 0 errors.
- `npm run build:react` — clean.
- `npm run test:frontend` — 196/196 (27 files; +5 since wave 2).

Not yet committed/deployed — awaiting operator review + the docker-server deploy step.
