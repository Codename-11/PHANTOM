# AI Sync — Containerization & Toolpack Profiles

This plan turns PHANTOM into a Docker-on-Linux first project with build-time
and runtime toolpack profiles. Windows remains the dev environment only.

## Locked decisions

- **Primary install target:** Docker on Linux. `docker compose up` becomes the
  canonical run command; `npm install` is demoted to "dev environment."
- **Topology:** Monolith image (PHANTOM + sec-ops tools in one container).
  Variants via build args (`phantom:base`, `phantom:offensive`, `phantom:blue`,
  `phantom:full`, operator-defined).
- **Base:** `debian:stable-slim`. Production backends are `apt` + `pipx` + `go`
  only. The multi-backend code in `server/tools/installer.js` (winget/choco/
  scoop/wsl-apt/brew) stays for dev-on-Windows but is **not** load-bearing in
  production.
- **Dual-mode profiles:** A single profile (`{ name, description, toolIds[] }`)
  resolves to either (a) a Dockerfile `RUN` fragment (build-time, baked) or
  (b) a runtime install plan that reuses the existing approval-gated path.
  Source of truth: `expandProfile(id) → toolIds[]`.
- **Persistence:** Named Docker volumes for `/app/workspace` and `/app/phantom.db`.
  No bind mounts in `docker-compose.yml`. SQLite WAL files live with the DB on
  the same volume.
- **No uninstall path.** Rebuild without the line is the natural reset.
- **No split-container.** PHANTOM is the container; there is no host/container
  distinction in production.

## Phases (build order)

### Phase 1 — Container substrate (no tools yet)
- `Dockerfile` at repo root: `debian:stable-slim` → install Node 20 + python3 +
  pipx + golang → `npm ci` → `npm run build` (frontend + docs) → expose 1337 →
  `CMD ["node", "server/index.js"]`.
- `docker-compose.yml`: `phantom` service on port 1337, named volumes
  `phantom-workspace` (mounts `/app/workspace`) and `phantom-db` (mounts
  `/app/phantom.db` directory or sibling), env passthrough for
  `API_BASE_URL`, `API_KEY`, `MODEL_ID`.
- `.dockerignore`: `node_modules/`, `workspace/`, `*.db*`, `.design-fetch*/`,
  `.verify-shots/`, `.claude/`, `tests/__pycache__/`.
- **Layer order:** deps (rarely change) → tool layer (occasional) → source
  copy (frequent). Maximizes `docker build` cache hits.

### Phase 2 — Docker smoke target
- `scripts/smoke-docker.js` (cross-shell, mirror `scripts/run-tests.js` style):
  `docker compose build` → `up -d` → poll `/api/installer/status` until 200 or
  60s timeout → hit `/api/onboarding/status`, `/api/runs`, `/api/toolpacks` →
  `compose down`. Non-zero on any failure.
- New `npm run smoke:docker` script in `package.json`.
- **Goal:** catch dev/prod drift in <60s without leaving the Windows editor.

### Phase 3 — Tool install via build args
- `scripts/install-profile.sh` (POSIX): reads `$1` (profile name), emits
  `apt-get install -y --no-install-recommends ...`, then `pipx install ...`,
  then `go install ...` for tools in that profile. Static map for now
  (`base | offensive | blue | full`); profile-table lookup arrives in Phase 5.
- Dockerfile gets `ARG PROFILE=base` + `RUN /tmp/install-profile.sh "$PROFILE"`.
- Size discipline: `--no-install-recommends`, `tshark` not `wireshark` GUI,
  Metasploit behind a separate `ARG INCLUDE_MSF=0`.
- Refactor `server/tools/installer.js:27-34` and `:37-45`: replace the
  `eval("require")('fs')` pattern with a static import; honor a
  `PHANTOM_BACKEND` env var so detection is short-circuited inside the
  container.

### Phase 4 — Profile table + REST CRUD
- New SQLite table `profiles { id TEXT PK, name TEXT UNIQUE, description TEXT,
  tool_ids JSON, created_at, updated_at }`. Migration follows the pattern in
  `server/memory/`.
- `server/profiles/profile-store.js` — pure CRUD against the table.
- `server/profiles/profile-resolver.js` — exports:
  - `expandProfile(id) → toolIds[]`
  - `renderProfileAsDockerfile(id) → string` (RUN fragment, includes pipx/go
    where apt isn't available)
  - `resolveProfileAsInstallPlan(id) → plan` (delegates to existing
    `resolveInstallPlan` in `server/tools/installer.js`)
- Routes in `server/routes/api.js`:
  - `GET /api/profiles`, `POST /api/profiles`, `PUT /api/profiles/:id`,
    `DELETE /api/profiles/:id`
  - `GET /api/profiles/:id/dockerfile` (returns text/plain RUN fragment)
  - `POST /api/profiles/:id/install` (creates a pending install request,
    routes through existing approvals queue — no new approval surface)
- **Tests (RED-first):** `server/profiles/profile-store.test.js`,
  `server/profiles/profile-resolver.test.js`, plus route coverage in the
  existing `server/routes/api.test.js`.

### Phase 5 — Profile UI in Settings
- Settings → **Tools / MCP / Skills** gets a new **Profiles** subtab.
- Vanilla JS, follow the pattern in `frontend/js/pages/installer-panel.js`.
- CRUD list, "Apply runtime" (POSTs `/api/profiles/:id/install`, surfaces in
  Approvals queue), "Export Dockerfile" (downloads `.dockerfile` snippet).
- Render-stub tests follow `frontend/js/pages/installer-panel.test.js`.

### Phase 6 — Docs + image variants
- `scripts/build-variants.js`: builds and tags `phantom:base`,
  `phantom:offensive`, `phantom:blue`, `phantom:full` from the same Dockerfile.
- Update `README.md` install section: `docker compose up` is the headline path,
  `npm install` is demoted to "Dev environment (Windows/macOS)."
- Update `user-docs/` install page (VitePress).
- Append a DEVLOG entry following the existing format.

## Validation gates per phase

Every phase must pass before moving on:

- `node --check` on every changed `.js` file.
- `npm test` — full suite stays green (currently 155/155).
- From Phase 2 onward: `npm run smoke:docker` passes.
- `git diff --check`.
- UI phases: settings page renders, no browser console errors, manual smoke
  through Chat → Run → Synthesis path.

## Out of scope

- Multi-container split (sidecar ops container). Monolith locked.
- Live uninstall path.
- Cross-architecture (arm64) images. Defer until requested.
- Image registry push automation. Manual `docker push` for now.
- Migration tooling from existing host-installed tools to container. Operators
  rebuild fresh.
- Windows production support. Explicit no.

## Risks & loose ends

- **Image size.** Metasploit + BloodHound + Wireshark together can push
  `phantom:full` past 10GB. Mitigations: per-tool build args,
  `--no-install-recommends`, ship slim variants by default.
- **SQLite WAL on Docker volumes.** Should be fine with named volumes;
  validate with a concurrent-run + restart smoke during Phase 1.
- **`eval("require")('fs')` in `installer.js`.** Pre-existing brittle pattern;
  replace as part of Phase 3 cleanup, not a separate phase.
- **Vite build inside container.** `npm run build` invokes
  `vite build frontend` + VitePress build for `user-docs/`. Verify both work
  on `debian:stable-slim` + Node 20 in Phase 1.
- **`API_KEY` in env var.** Fine for now; Docker secrets are future hardening.

## Touchpoints (file index)

- New: `Dockerfile`, `docker-compose.yml`, `.dockerignore`,
  `scripts/install-profile.sh`, `scripts/smoke-docker.js`,
  `scripts/build-variants.js`,
  `server/profiles/profile-store.js`,
  `server/profiles/profile-store.test.js`,
  `server/profiles/profile-resolver.js`,
  `server/profiles/profile-resolver.test.js`,
  `frontend/js/pages/profiles-panel.js`,
  `frontend/js/pages/profiles-panel.test.js`.
- Edit: `package.json` (scripts), `server/tools/installer.js` (env-var
  override, drop `eval("require")`), `server/routes/api.js` (new routes),
  `server/routes/api.test.js` (route coverage),
  `frontend/js/pages/settings-page.js` (new subtab),
  `README.md`, `DEVLOG.md`, `user-docs/` install page,
  `ai_sync/security.md` (mention containerization).
