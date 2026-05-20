# PHANTOM Goal Engine Plan

> **For Hermes:** Use `subagent-driven-development` or a long-running coding agent to implement this plan task-by-task. Keep changes additive, governed, and trace-backed.

**Goal:** Add a governed Goal Engine to PHANTOM so operators can launch scoped security objectives that continue across multiple child runs until completion, blocker, approval gate, budget limit, or human stop.

**Architecture:** PHANTOM owns campaign state, scope, trace, artifacts, findings, approvals, and replay. Individual workers may use native PHANTOM model/tool runs, Codex `exec`, or a future Codex `/goal` adapter, but external agents are workers only—not the source of truth. Every worker action must resolve back into PHANTOM `runs`, `trace_events`, `artifacts`, `findings`, and graph/replay bundles.

**Tech Stack:** Node/Express, SQLite via `better-sqlite3`, current PHANTOM run/trace/artifact stores, vanilla JS frontend pages, existing toolpacks/scope/prompt fragments, optional Codex CLI adapter.

---

## Concept

John Hammond's useful abstraction is not “loop forever.” It is:

```text
Goal -> worker run -> proof artifacts -> evaluator -> next goal / approval / done
```

PHANTOM should implement the smarter, governed version:

```text
Campaign
  -> Goal queue
    -> Child run
      -> trace events
      -> artifacts
      -> findings
      -> graph/replay
    -> completion evaluator
    -> next goal / retry / branch / pause / approval / done
```

This avoids the worst Ralph-loop failure modes: repeated mistakes, spam, uncontrolled probing, context bloat, and unclear stop conditions.

## Non-Goals

- Do not make Codex `/goal` a hard dependency.
- Do not add global YOLO/autonomous mode.
- Do not allow out-of-scope network/security work just because a campaign is running.
- Do not create frontend-only fake state; campaign UI must read durable backend state.
- Do not require every quick chat to become a campaign.

## Core Principles

1. **PHANTOM is supervisor, not worker.** It owns policy/state/evidence; agents execute bounded units.
2. **Every child action is a normal PHANTOM run.** Existing replay, graph, artifacts, scope, and prompt snapshots must keep working.
3. **Goal continuation is explicit.** Continue only when the evaluator says `continue`, `retry`, `branch`, or `next_goal` within budgets.
4. **Approval gates are first-class.** Exploit/destructive/credentialed/online-bruteforce actions pause into `needs_approval` unless explicitly authorized by scope and policy.
5. **Artifacts are the contract.** Campaigns advance based on evidence, not vibes. Very tactical. Very unglamorous. Correct.

## Data Model

### New table: `campaigns`

Fields:

- `id`
- `title`
- `objective`
- `status`: `draft | queued | running | paused | needs_approval | completed | failed | canceled`
- `scope_id`
- `prompt_profile_id`
- `toolpack_ids_json`
- `worker_backend`: `phantom-native | codex-exec | codex-goal-experimental`
- `risk_budget_json`
- `run_budget_json`
- `notification_policy_json`
- `created_at`, `updated_at`, `started_at`, `ended_at`

### New table: `campaign_goals`

Fields:

- `id`
- `campaign_id`
- `parent_goal_id`
- `title`
- `prompt`
- `status`: `queued | running | blocked | needs_approval | completed | failed | skipped`
- `priority`
- `attempt_count`
- `max_attempts`
- `completion_criteria_json`
- `evaluator_result_json`
- `created_at`, `updated_at`, `started_at`, `ended_at`

### New table: `campaign_goal_runs`

Fields:

- `id`
- `campaign_id`
- `goal_id`
- `run_id`
- `worker_backend`
- `status`
- `created_at`

### New trace event types

- `campaign.started`
- `campaign.paused`
- `campaign.completed`
- `campaign.failed`
- `campaign.canceled`
- `goal.queued`
- `goal.started`
- `goal.completed`
- `goal.failed`
- `goal.blocked`
- `goal.needs_approval`
- `goal.evaluated`
- `goal.next_selected`
- `worker.spawned`
- `worker.heartbeat`
- `worker.budget_exhausted`

## Backend Modules

Create:

- `server/campaigns/campaign-store.js`
- `server/campaigns/goal-store.js`
- `server/campaigns/goal-engine.js`
- `server/campaigns/goal-evaluator.js`
- `server/campaigns/worker-backends/phantom-native.js`
- `server/campaigns/worker-backends/codex-exec.js`
- `server/campaigns/campaign-store.test.js`
- `server/campaigns/goal-engine.test.js`
- `server/campaigns/goal-evaluator.test.js`

Modify:

- `server/memory/store.js` — schema migrations and store exports if PHANTOM keeps persistence centralized.
- `server/index.js` — WebSocket or server-side dispatch hooks only if needed.
- `server/routes/api.js` — Campaign API routes.
- `server/ai/system-prompt.js` — campaign/goal context fragment support.
- `server/prompts/prompt-store.js` — optional goal prompt template storage.
- `server/assets/asset-store.js` — optional campaign-derived rerun templates.
- `server/graph/graph-derive.js` — aggregate campaign graph view later.

## Frontend Modules

Create:

- `frontend/js/pages/campaigns-page.js`
- `frontend/js/pages/campaign-detail-page.js`
- `frontend/js/campaigns/campaign-client.js`
- `frontend/js/campaigns/campaign-presenter.js`
- `frontend/js/campaigns/campaign-presenter.test.js`

Modify:

- `frontend/js/router.js` — add `campaigns` route.
- `frontend/index.html` — add nav entry and page shell.
- `frontend/css/styles.css` — campaign queue, worker cards, goal status chips.
- `frontend/js/pages/runs-page.js` — show campaign/goal linkage when present.
- `frontend/js/pages/graph-page.js` — link from campaign goal to child run graph.
- `frontend/js/pages/settings-page.js` — show default campaign budgets/policies later.

## API Shape

### Campaign CRUD

- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/campaigns/:id`
- `PATCH /api/campaigns/:id`
- `POST /api/campaigns/:id/start`
- `POST /api/campaigns/:id/pause`
- `POST /api/campaigns/:id/resume`
- `POST /api/campaigns/:id/cancel`

### Goal operations

- `GET /api/campaigns/:id/goals`
- `POST /api/campaigns/:id/goals`
- `PATCH /api/campaigns/:id/goals/:goalId`
- `POST /api/campaigns/:id/goals/:goalId/run`
- `POST /api/campaigns/:id/goals/:goalId/evaluate`

### Replay / evidence

- `GET /api/campaigns/:id/replay`
- `GET /api/campaigns/:id/graph`
- `POST /api/campaigns/:id/artifacts/report`
- `POST /api/campaigns/:id/artifacts/evidence-bundle`

## Worker Backends

### `phantom-native`

Default backend.

- Creates a normal PHANTOM child run using current `processMessage` path.
- Uses selected scope/profile/toolpacks.
- Persists child run ID and links it to campaign goal.
- Lets existing trace/artifact/graph behavior do the heavy lifting.

### `codex-exec`

Optional backend for repo/lab-heavy work.

- Uses Codex CLI non-interactively only inside a configured working directory.
- Starts with conservative sandbox defaults.
- Captures stdout/stderr into artifacts.
- Converts completion into PHANTOM trace events and evaluator input.
- Never bypasses PHANTOM scope policy by default.

Example shape:

```bash
codex exec \
  --sandbox workspace-write \
  --ask-for-approval never \
  --cd "$WORKDIR" \
  "$GOAL_PROMPT"
```

Only use `--dangerously-bypass-approvals-and-sandbox` inside an externally sandboxed lab enclave and only when PHANTOM records that policy mode.

### `codex-goal-experimental`

Future adapter only.

- Detect availability at runtime.
- Treat as experimental.
- Require explicit operator opt-in.
- Keep PHANTOM campaign state as canonical even if Codex manages its own sub-loop.

## Safety / Governance

Campaign creation must require:

- active `scope_id` for any security/network campaign
- selected toolpacks
- risk budget
- max child runs
- timeout
- notification policy
- completion criteria

Default limits:

```json
{
  "maxChildRuns": 10,
  "maxAttemptsPerGoal": 2,
  "maxWallClockMinutes": 120,
  "maxConsecutiveNoProgress": 2,
  "allowedRiskClasses": ["read/local", "recon", "network-scan"],
  "blockedRiskClasses": ["exploit", "destructive", "credentialed", "online-bruteforce"],
  "pauseOnNewFinding": true,
  "pauseOnApprovalRequired": true
}
```

Approval-required conditions:

- exploit-class action
- destructive action
- credentialed action
- online brute force / password spraying
- target outside active scope
- campaign wants to expand scope
- campaign wants to register/log into a third-party service
- campaign wants to publish or send external notification beyond configured channels

## Completion Evaluator

Evaluator input:

- goal prompt
- child run summary
- trace event stats
- artifacts created
- findings created
- blocked/failed tool calls
- graph observations
- budget state

Evaluator output schema:

```json
{
  "decision": "continue | retry | branch | next_goal | needs_approval | complete | fail | pause",
  "confidence": 0.0,
  "summary": "short operator-readable result",
  "evidence": ["artifact-id-or-run-link"],
  "newGoals": [
    {
      "title": "string",
      "prompt": "string",
      "priority": 0,
      "completionCriteria": {}
    }
  ],
  "approvalRequest": {
    "riskClass": "string",
    "target": "string",
    "reason": "string",
    "proposedAction": "string"
  },
  "stopReason": "string"
}
```

Hard rule: evaluator may propose next actions, but the policy gate still decides whether a tool can execute.

## Implementation Tasks

### Task 1: Add campaign persistence tests

**Objective:** Define expected persistence behavior before schema work.

**Files:**

- Create: `server/campaigns/campaign-store.test.js`
- Modify: `server/memory/store.js` or new campaign store bootstrap

**Steps:**

1. Add tests for creating/listing/getting/updating campaigns.
2. Add tests for creating queued goals under a campaign.
3. Add tests for linking existing run IDs to campaign goals.
4. Run: `npm test -- server/campaigns/campaign-store.test.js`
5. Expected first result: fail because store does not exist.

### Task 2: Add campaign/goal schema and store

**Objective:** Implement minimal durable campaign state.

**Files:**

- Create: `server/campaigns/campaign-store.js`
- Create: `server/campaigns/goal-store.js`
- Modify: `server/memory/store.js`

**Steps:**

1. Add schema migration for `campaigns`, `campaign_goals`, `campaign_goal_runs`.
2. Implement store functions:
   - `createCampaign`
   - `listCampaigns`
   - `getCampaign`
   - `updateCampaignStatus`
   - `createCampaignGoal`
   - `listCampaignGoals`
   - `linkGoalRun`
3. Run campaign store tests.
4. Run full `npm test`.
5. Commit: `feat: add campaign goal persistence`.

### Task 3: Add Campaign API routes

**Objective:** Expose campaign CRUD and goal list endpoints.

**Files:**

- Modify: `server/routes/api.js`
- Create or extend: `server/routes/api.test.js`

**Steps:**

1. Write tests for `POST /api/campaigns`, `GET /api/campaigns`, `GET /api/campaigns/:id`.
2. Add tests for `POST /api/campaigns/:id/goals`, `GET /api/campaigns/:id/goals`.
3. Implement routes.
4. Verify invalid scope/profile/toolpack IDs fail safely.
5. Run `npm test`.
6. Commit: `feat: expose campaign goal api`.

### Task 4: Add campaign page shell

**Objective:** Make campaigns visible before execution exists.

**Files:**

- Modify: `frontend/js/router.js`
- Modify: `frontend/index.html`
- Modify: `frontend/css/styles.css`
- Create: `frontend/js/pages/campaigns-page.js`
- Create: `frontend/js/campaigns/campaign-client.js`
- Create: `frontend/js/campaigns/campaign-presenter.js`
- Create: `frontend/js/campaigns/campaign-presenter.test.js`

**Steps:**

1. Add route `campaigns`.
2. Render campaign list with status, scope, backend, budget, and latest goal count.
3. Add empty state explaining campaigns are governed multi-run goals.
4. Add presenter tests for redaction/status chips.
5. Run `npm test` and `npm run build`.
6. Commit: `feat: add campaign workspace page`.

### Task 5: Add campaign creation form

**Objective:** Let operators define a governed campaign without starting it.

**Files:**

- Modify: `frontend/js/pages/campaigns-page.js`
- Modify: `frontend/css/styles.css`
- Modify: `server/routes/api.js`

**Steps:**

1. Add fields: objective, scope, profile, toolpacks, backend, max child runs, timeout, allowed risk classes.
2. Require scope when selected risk/toolpacks include network/security actions.
3. Save campaign as `draft`.
4. Show generated initial goal prompt preview.
5. Run UI presenter tests and build.
6. Commit: `feat: add governed campaign creation form`.

### Task 6: Add phantom-native worker backend

**Objective:** Execute one campaign goal as a normal PHANTOM child run.

**Files:**

- Create: `server/campaigns/worker-backends/phantom-native.js`
- Create: `server/campaigns/goal-engine.js`
- Modify: `server/index.js` or refactor message processing into reusable run service
- Modify: `server/routes/api.js`

**Steps:**

1. Extract reusable `startRunFromGoal` path if needed so WebSocket chat and campaign workers share run creation logic.
2. Create child run with campaign goal prompt.
3. Link child run in `campaign_goal_runs`.
4. Emit `worker.spawned`, `goal.started`, and `goal.completed/failed` trace events.
5. Add tests that a campaign goal creates a linked run record.
6. Commit: `feat: run campaign goals with native phantom worker`.

### Task 7: Add completion evaluator MVP

**Objective:** Decide whether a completed child run means done, retry, blocked, or needs approval.

**Files:**

- Create: `server/campaigns/goal-evaluator.js`
- Create: `server/campaigns/goal-evaluator.test.js`
- Modify: `server/campaigns/goal-engine.js`

**Steps:**

1. Start with deterministic evaluator rules:
   - blocked tool call -> `needs_approval` or `blocked`
   - finding created -> `complete` or `pause` depending `pauseOnNewFinding`
   - no artifacts and no findings -> `retry` until attempts exhausted
   - budget exhausted -> `pause` or `fail`
2. Store evaluator result JSON on goal.
3. Emit `goal.evaluated` trace event.
4. Run tests.
5. Commit: `feat: evaluate campaign goal completion`.

### Task 8: Add campaign start/pause/resume/cancel controls

**Objective:** Give operator control over long-running automation.

**Files:**

- Modify: `server/routes/api.js`
- Modify: `server/campaigns/goal-engine.js`
- Modify: `frontend/js/pages/campaigns-page.js`

**Steps:**

1. Implement `POST /start`, `/pause`, `/resume`, `/cancel`.
2. Ensure pause prevents new child runs but does not corrupt current completed run state.
3. Ensure cancel stops future work and marks queued goals skipped/canceled.
4. Render controls and disabled states.
5. Run tests/build.
6. Commit: `feat: add campaign lifecycle controls`.

### Task 9: Add campaign replay and report bundle

**Objective:** Make a campaign reviewable like a run, but across child runs.

**Files:**

- Modify: `server/routes/api.js`
- Create: `server/campaigns/campaign-replay.js`
- Modify: `frontend/js/pages/campaign-detail-page.js`
- Modify: `server/artifacts/artifact-store.js`

**Steps:**

1. Build replay bundle: campaign, goals, linked runs, artifacts, findings, blocked events, budget summary.
2. Add report artifact generation.
3. Add evidence bundle export across child runs.
4. Render campaign timeline and child run cards.
5. Run tests/build/smoke.
6. Commit: `feat: add campaign replay and evidence exports`.

### Task 10: Add optional Codex exec backend

**Objective:** Allow PHANTOM to spawn Codex as a bounded worker while keeping PHANTOM state canonical.

**Files:**

- Create: `server/campaigns/worker-backends/codex-exec.js`
- Create: `server/campaigns/worker-backends/codex-exec.test.js`
- Modify: `server/campaigns/goal-engine.js`
- Modify: Settings/Campaign UI backend selector

**Steps:**

1. Detect `codex` availability with `codex --version`.
2. Require configured working directory.
3. Use safe default sandbox/approval flags.
4. Capture stdout/stderr as artifacts.
5. Convert Codex completion into evaluator input.
6. Mark `/goal` mode experimental and hidden unless detected/configured.
7. Run tests/build.
8. Commit: `feat: add optional codex campaign worker backend`.

## Verification Pipeline

Run before claiming implementation complete:

```bash
cd ~/projects/PHANTOM
npm test
npm run build
find server frontend/js -name '*.js' -print0 | xargs -0 -n1 node --check
python3 tests/smoke_test.py
python3 tests/graph_viewer_smoke.py
git diff --check
```

If campaign UI changes are non-trivial, add a Playwright campaign smoke test before merge.

## Acceptance Criteria

- Campaigns persist across restart.
- Campaign goals persist and link to child runs.
- A campaign can spawn at least one native PHANTOM child run.
- Child runs still produce normal traces/artifacts/graphs.
- Campaign page shows campaign status, active/queued goals, child runs, and blockers.
- Evaluator can mark `complete`, `retry`, `blocked`, `needs_approval`, or `pause`.
- Scope policy remains enforced before tool execution.
- Campaign evidence bundle exports child run artifacts and trace summaries.
- Operator can pause/cancel a campaign.
- Codex backend is optional and never required for PHANTOM-native operation.

## Deferred

- True parallel worker pool.
- Cross-campaign learning/corpus building.
- Auto-registration for third-party CTFs/services.
- Mobile notification routing.
- External Artifact Preview publishing by default.
- Full Codex `/goal` adapter until stable and discoverable from CLI/config.
