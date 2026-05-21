# PHANTOM Self-Learning (Agent-Memory / Skill-Library) — Design Doc

**Status:** Design / research. No application code changed by this doc.
**Date:** 2026-05-20
**Author:** research pass (grounded in the live codebase)

## 0. Scope & framing

This proposes a Voyager / SkillWeaver / Hermes-style **agent-memory loop** for PHANTOM:
extract reusable skills from successful runs, persist run episodes, reflect on
failures, and retrieve all three at plan-time to seed the agent. PHANTOM is a
**governance-first** security cockpit, so the design's load-bearing constraint is
that *nothing learned can widen the agent's authority*. Learned knowledge is
**advisory context**, never a new capability — exactly the posture the codebase
already takes with goals (`server/goals/goal-progress.js` comment: "Status
transitions stay operator-driven — this never closes a goal on its own"; and
`server/ai/system-prompt.js` line 268: "Scope policy always takes precedence over
goal progress").

The good news: PHANTOM already has every structural seam this needs. The learning
loop is a near-exact sibling of two existing post-run hooks
(`recordRunOutcomeAgainstGoal` and `finalizeRunForCampaign`) plus one prompt-time
injection block (`renderActiveGoalBlock`). We are adding a fourth analyzer to a
proven three-call terminal sequence, and a third block to a proven prompt
assembler.

---

## 1. Where it plugs in (real files, real functions)

### 1.1 Extraction hook — the three terminal branches in `server/index.js`

When a run reaches a terminal status, `server/index.js` (lines ~532–559) already
runs the identical pair on all three branches (`stopped`, error→`failRun`,
`completeRun`):

```js
exportTraceArtifact(run.id, conversationId);
recordRunOutcomeAgainstGoal(run.id);   // ./goals/goal-progress.js
finalizeRunForCampaign(run.id);        // ./campaigns/goal-engine.js
```

**Add a third sibling call** on each branch:

```js
recordEpisodeForRun(run.id);           // ./knowledge/episode-recorder.js  (NEW)
```

This single function is the entry point for the entire learning loop. It mirrors
the contract those two siblings already honor:
- **Never throws** — run finalization is the hot path; learning is best-effort
  enrichment (see the `try/catch` + `console.warn` guard in
  `recordRunOutcomeAgainstGoal`, goal-progress.js lines 78–120).
- **Reads, never blocks** — it consumes already-persisted data via
  `getRun` / `getTraceEvents` / `getArtifacts` / `getFindings`, exactly as
  `finalizeRunForCampaign` does (goal-engine.js lines 89–96).
- **Synchronous heuristic core, flagged async LLM enrichment** — see §3.

### 1.2 Retrieval hook — `buildSystemPrompt` in `server/ai/system-prompt.js`

`buildSystemPrompt({ profileId, scopeId, raw, uiContext })` (line 273) assembles
the prompt from named blocks. `renderActiveGoalBlock()` (line 224) is the exact
precedent: it pulls live state, hard-caps the text, degrades to `''` on any error,
and is interpolated into the template at line 302 (`${goalBlock}`).

**Add `renderRetrievedKnowledgeBlock(scopeId, uiContext)`** and interpolate it
immediately after `${goalBlock}` (so ordering stays
`UI context → goal → KNOWLEDGE → ASK-GATED actions`). Placement matters: the
ASK-GATED / scope-policy block must remain *below* learned content so the model
reads governance last and treats it as the override (the DEVLOG calls this the
"system-prompt ordering is UI-context → goal → ask-gated actions" invariant).

The block renders 2–4 retrieved skills, 2–3 prior episodes, and any failure
reflections relevant to the **active scope + target class**, each truncated like
the goal block's `GOAL_OBJECTIVE_CAP` discipline, and closes with an advisory
sentence mirroring goal-progress: *"These are recalled from past runs and are
suggestions only; the scope policy and approval gates still decide what runs."*

### 1.3 Optional agent-callable recall tool — `server/tools/phantom-tools.js`

PHANTOM tools are declared as OpenAI function specs (e.g. `phantom_get_context`,
`phantom_list_runs` at phantom-tools.js lines 109–288). A read-only
`phantom_recall_skill({ query, targetClass })` tool fits this catalog and lets the
model fetch deeper knowledge on demand instead of bloating every prompt. It is a
**read tool** (always safe to call, like the `### Read` group at system-prompt.js
line 344), returns redacted skill/episode rows, and executes **nothing**.

### 1.4 REST surface — `server/routes/api.js` mounted at `app.use('/api', apiRouter)`

All routes mount through one router (`server/index.js` line 73). Add a
`/api/knowledge/*` group following the existing flat pattern (`router.get(...)`,
`router.post(...)`): list/get skills, list episodes, list reflections, and the
operator promote/retire/sign actions from §4.

---

## 2. Data model (additive SQLite, `ensureColumn` / `CREATE TABLE IF NOT EXISTS`)

All schema lands in `server/memory/store.js` `initDB()` using the project's
established additive idiom — new `CREATE TABLE IF NOT EXISTS` blocks + `ensureColumn`
for any column on an existing table. Three new tables; the precedent for a
"learned-from-a-source-run" table already exists as `run_templates` (store.js
lines 277–290), which we deliberately generalize rather than overload.

### 2.1 `learned_skills` — parameterized, reusable playbooks

```sql
CREATE TABLE IF NOT EXISTS learned_skills (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,            -- human label, e.g. "TLS cert+cipher recon"
  slug               TEXT NOT NULL UNIQUE,     -- stable retrieval key
  description        TEXT,                      -- one-line "what + when to use"
  target_class       TEXT,                      -- 'web' | 'host' | 'network' | 'domain' | ...
  steps_json         TEXT NOT NULL,             -- ordered [{tool, argTemplate, note, riskClass}]
  required_actions_json TEXT,                   -- action classes the skill needs (recon, network-scan…)
  source_run_id      TEXT,                      -- provenance: the run it was distilled from
  source_scope_id    TEXT,                      -- scope under which it was learned
  origin             TEXT NOT NULL DEFAULT 'extracted', -- 'extracted' | 'operator'
  status             TEXT NOT NULL DEFAULT 'candidate',  -- 'candidate' | 'approved' | 'retired'
  use_count          INTEGER DEFAULT 0,
  success_count      INTEGER DEFAULT 0,         -- updated when a replay run lands 'completed'
  trust_digest       TEXT,                      -- sha256:<hex> of canonical steps_json (see §4.4)
  trust_signature    TEXT,                      -- optional ed25519 sig (operator-signed skill)
  trust_signed_by    TEXT,
  signature_status   TEXT DEFAULT 'unsigned',   -- 'unsigned'|'verified'|'invalid' (mirrors registry)
  metadata_json      TEXT,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_run_id)   REFERENCES runs(id)   ON DELETE SET NULL,
  FOREIGN KEY (source_scope_id) REFERENCES scopes(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_learned_skills_target ON learned_skills(target_class);
CREATE INDEX IF NOT EXISTS idx_learned_skills_status ON learned_skills(status);
```

Key governance columns: `required_actions_json` (what the skill *would need*, so it
can be intersected against the active scope's `allowed_actions` before it's ever
suggested — §4.2), and `status` defaulting to `candidate` (a learned skill is
**not** retrieval-eligible until an operator promotes it to `approved`, mirroring
`registry_sources.enabled = 0` deny-by-default at store.js line 497).

### 2.2 `run_episodes` — episodic memory of attempts

```sql
CREATE TABLE IF NOT EXISTS run_episodes (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL UNIQUE,         -- one episode per run
  scope_id        TEXT,
  campaign_id     TEXT,                          -- nullable; links episode to a campaign
  goal_id         TEXT,
  target_class    TEXT,
  objective       TEXT,                          -- run.goal at episode time
  outcome         TEXT NOT NULL,                 -- 'success'|'partial'|'failure'|'blocked'
  posture_score   INTEGER,                       -- from synthesis.posture.score
  tool_sequence_json TEXT,                       -- compact ordered tool calls (names + risk only)
  finding_count   INTEGER DEFAULT 0,
  blocked_count   INTEGER DEFAULT 0,
  evidence_refs_json TEXT,                        -- artifact ids + finding ids (pointers, not blobs)
  summary         TEXT,                          -- redacted one-paragraph recap
  embedding_json  TEXT,                           -- optional, phase 4+ for semantic retrieval
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id)      REFERENCES runs(id)       ON DELETE CASCADE,
  FOREIGN KEY (scope_id)    REFERENCES scopes(id)     ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_run_episodes_scope  ON run_episodes(scope_id);
CREATE INDEX IF NOT EXISTS idx_run_episodes_target ON run_episodes(target_class);
CREATE INDEX IF NOT EXISTS idx_run_episodes_outcome ON run_episodes(outcome);
```

`outcome` derives deterministically from the existing synthesis shape
(`synthesis.objectives.met` + `posture.rating` + `activity.toolCalls`, see
`buildRunSynthesis` at synthesis.js line 322 and the scoring heuristic in
goal-progress.js lines 31–64). `evidence_refs_json` stores **pointers** to
`artifacts.id` / `findings.id` — never copied content — so episodes inherit the
existing redaction guarantees rather than re-leaking secrets.

### 2.3 `failure_reflections` — "why it failed, what to try differently"

```sql
CREATE TABLE IF NOT EXISTS failure_reflections (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  episode_id    TEXT,
  scope_id      TEXT,
  target_class  TEXT,
  failure_kind  TEXT,                            -- 'blocked'|'tool_error'|'no_progress'|'denied'
  what_failed   TEXT NOT NULL,                   -- redacted
  why           TEXT,                            -- LLM or heuristic hypothesis
  try_next      TEXT,                            -- alternative approach
  source        TEXT NOT NULL DEFAULT 'heuristic', -- 'heuristic' | 'llm'
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id)     REFERENCES runs(id)         ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES run_episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id)   REFERENCES scopes(id)       ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_failure_reflections_run    ON failure_reflections(run_id);
CREATE INDEX IF NOT EXISTS idx_failure_reflections_target ON failure_reflections(target_class);
```

### 2.4 Relationships

```
campaigns ──< run_episodes >── runs ──< failure_reflections
scopes ──< run_episodes                runs ──< learned_skills (source_run_id)
scopes ──< learned_skills (source_scope_id)
run_episodes ──< failure_reflections (episode_id)
```

`run_episodes.run_id UNIQUE` keeps it 1:1 with runs (the episode IS the run's
learned-memory projection). Skills and reflections are many-per-run.

### 2.5 Should learned skills be signed? (registry interaction)

PHANTOM's registry already has a complete ed25519 verify model:
`server/registry/manifest-signer.js` exposes `computeManifestDigest(bytes)` →
`"sha256:<hex>"` and `verifyManifestSignature(...)`, and every manifest carries
`signatureStatus ∈ {unsigned, unknown_signer, verified, invalid}` (DEVLOG B3-prep).

**Recommendation:** learned skills are **locally-originated content, not imported
toolpacks**, so they do *not* need to ride the hosted-registry trust root. But we
reuse the *same primitives* for tamper-evidence:
- On promote-to-`approved`, compute `trust_digest = computeManifestDigest(canonical(steps_json))`.
- `signature_status` defaults `unsigned`; an operator who wants portable, verifiable
  skills can sign with a local key and PHANTOM verifies on load via the existing
  `manifest-signer.js` functions. This is the migration path if learned skills are
  ever *exported into* a hosted registry — they'd already be in the right shape.
- A learned skill must **never** reference a tool not present in the live tool
  registry (`server/tools/registry.js` / `phantom-tools.js`). Skill steps name
  tools; the executor and scope policy still gate each call at run time (§4.1).

---

## 3. The learning loop (sequence, in prose)

### Write path (run completes → extract → store)

1. A run hits a terminal branch in `server/index.js`. After
   `recordRunOutcomeAgainstGoal` + `finalizeRunForCampaign`, the new
   `recordEpisodeForRun(runId)` fires.
2. `episode-recorder.js` loads `getRun`, `getTraceEvents`, `getArtifacts`,
   `getFindings` (same reads as goal-engine.js lines 89–96) and computes
   `buildRunSynthesis(...)` (synthesis.js line 322).
3. **Always** writes one `run_episodes` row (deterministic `outcome` from
   synthesis). Episodic logging needs no LLM — this is the MVP (phase 1).
4. **If `outcome === 'success'` and posture is `strong|fair`:** run skill
   extraction. Heuristic v1 distills the trace's successful tool-call sequence
   (the `tool.call.started` → `tool.call.completed` chain in the trace) into a
   `learned_skills` row with `status='candidate'`. No LLM required for the
   deterministic shape; the LLM (phase 3) only writes the human `name` /
   `description` / arg-template generalization.
5. **If `outcome ∈ {failure, blocked}`:** run failure reflection. Heuristic v1
   classifies `failure_kind` from trace event types (blocked traces, `run.error`,
   `tool.call.approval.denied`). The LLM (phase 4) writes `why` / `try_next`.

### LLM invocation shape (distillation + reflection)

Reuse the **exact** dependency-injected, JSON-validated, fail-open pattern from
`enrichSynthesisWithLLM(synthesis, events, { llmCompleteJson, abortSignal })`
(synthesis.js line 505). That function: builds a compact `system + user` prompt
from the run summary + last ~20 trace events (line 427), asks for **JSON only** in
a fixed shape (line 444), validates against an allow-list, and **returns the
heuristic result unchanged on any failure** (line 506+). The skill-distillation
and reflection prompts follow the same template:

- **System:** "You are PHANTOM's skill distiller. From this successful run's tool
  sequence, produce a reusable, parameterized playbook. Return JSON only:
  `{ name, description, targetClass, steps:[{tool, argTemplate, note}] }`. Use only
  tools that appear in the trace. Do not invent tools. Do not include secrets,
  IPs, or hostnames — use `<TARGET>` / `<PORT>` placeholders."
- **Reflection system:** "...return `{ failureKind, whatFailed, why, tryNext }`...
  Reference only what the trace shows."
- Both gated behind a setting flag (`knowledge_llm_enabled`, off by default),
  exactly mirroring `synthesis_llm_enabled` (synthesis.js line 408) and the
  reserved `enrichGoalProgressWithLLM` no-op shell (goal-progress.js line 129).

### Read path (next run → retrieve → seed plan)

6. A new run builds its prompt via `buildSystemPrompt({ scopeId, uiContext })`.
7. `renderRetrievedKnowledgeBlock(scopeId, uiContext)` queries:
   `learned_skills` where `status='approved'` AND `target_class` matches the active
   target class AND `required_actions_json ⊆ scope.allowed_actions`; recent
   `run_episodes` for the same scope/target; relevant `failure_reflections`.
   Retrieval v1 is **keyword/tag + scope match** (no embeddings); phase 4 adds
   `embedding_json` semantic ranking if needed.
8. The block is truncated + redacted and injected *above* the ASK-GATED block. The
   model now plans with recalled context but every tool call it emits still passes
   through the executor's scope/policy gate.

---

## 4. Governance fit (the critical section)

PHANTOM's whole thesis is "powerful tools are useful only when operators can answer
what the agent was authorized to touch" (README). A self-learning loop must not
become a side channel that smuggles capability past the scope gate. Four hard
rules:

### 4.1 A learned skill is NOT a privilege — the gate runs regardless

A skill is a *suggestion of which tools to call in what order*. Replaying it does
**not** bypass anything: each step is still dispatched through
`server/tools/executor.js`, which classifies risk and evaluates against the active
scope **before execution** (README "Governed Runs"; DEVLOG: "the executor runs the
policy check before any tool dispatches"). A skill that names `exploit` steps under
a recon-only scope simply hits deny/ask gates step-by-step, identically to the
model proposing those calls itself. The skill cannot pre-authorize anything.

### 4.2 Scope-aware retrieval (don't even suggest out-of-scope skills)

`renderRetrievedKnowledgeBlock` intersects each candidate skill's
`required_actions_json` against the active scope's `allowed_actions` and only
surfaces skills whose required actions are a subset. This keeps the model from
being *primed* toward actions the scope forbids — a softer, earlier guard layered
on top of the hard executor gate. Episodes/reflections from a *different* scope are
shown read-only and clearly labeled with their origin scope, never as
instructions.

### 4.3 Should replaying a learned skill require approval?

**Yes, conditionally — and the existing machinery already does it.** Because every
step routes through the policy gate, any step whose action class is `ask` under the
active scope **automatically** produces an approval card (the `requestApproval`
path already wired into `processMessage`, system-prompt.js ASK-GATED block lines
303–317). So:
- A skill composed entirely of `auto` (read/recon) steps replays without friction.
- A skill containing any `ask`/`deny` step pauses at exactly that step.
- **Additionally**, promoting a `candidate` skill to `approved` (making it
  retrieval-eligible) is itself an **operator action** in the Knowledge UI — the
  human reviews the distilled steps before the agent can ever be seeded with them.
  This is the same deny-by-default posture as `registry_sources.enabled` and the
  "operator confirms completion" rule for goals/campaigns. **Recommendation:** for
  skills that include any non-`read/local` action class, surface a one-time
  "approve this learned playbook for reuse" gate (reuse `install_requests`-style
  approval-record plumbing), so a high-risk distilled sequence can't auto-promote.

### 4.4 Tamper-evidence + provenance

Every skill carries `source_run_id` + `source_scope_id` (auditable provenance) and
an optional `trust_digest`/signature via `manifest-signer.js`. The
single-trusted-operator model (mega-plan resolved decisions) means there's one
promoter; the digest makes silent post-promotion edits detectable.

---

## 5. Surfacing in the UI

Add a top-level **Knowledge** (or **Memory**) page to the React bundle, following
the established page pattern. The codebase gives a ready template: Campaigns and
Scope both use **list-aside + Sheet detail drawer** (App.tsx lines 77–84;
DEVLOG B2 "Page layout mirrors Campaigns: list aside + detail drawer").

- **New route** in `frontend/src/App.tsx`: `/knowledge` (bare) with `:id` child
  detail, plus a `/react/knowledge` preview alias during any parity window — the
  exact dual-mount pattern already used for every page.
- **New nav entry** in `frontend/src/components/AppShell.tsx` (sibling to
  Campaigns / Registry).
- **New page** `frontend/src/pages/Knowledge.tsx` with **Tabs** (reuse
  `components/ui/tabs.tsx`): *Skills · Episodes · Reflections*.
  - **Skills tab:** list of `learned_skills` as `ListRow`s with a `Badge` for
    `status` (candidate/approved/retired) and `target_class`; a trust pill
    reusing the Registry page's verified/unsigned pill idiom (DEVLOG B2); detail
    `Sheet` shows the step playbook, provenance link to the source run
    (`RunPill`), and **Approve / Retire** buttons (operator promote gate, §4.3).
  - **Episodes tab:** outcome-filtered list (reuse the Alerts/Approvals filter-chip
    + `SeverityBadge`-style vocabulary) linking each episode to its run + evidence
    artifacts.
  - **Reflections tab:** failure cards showing `what_failed / why / try_next`.
- **Types:** extend `frontend/src/lib/types.ts` with `LearnedSkill`, `RunEpisode`,
  `FailureReflection` interfaces mirroring the server `normalize*` shapes (the file
  already documents this "mirror the server normalize shape" convention, e.g.
  lines 130–167 for `ScopeRecord`).
- **Data layer:** a `frontend/src/lib/knowledge.ts` + React Query hook, matching
  `useCampaigns.ts` / `lib/runs.ts`.
- **Cross-links:** the Runs detail page (`Runs.tsx`) gains a small "Learned from
  this run" section listing any extracted skill / episode / reflection — closing
  the loop visibly for the operator.

No new shadcn primitives required — `card`, `badge`, `tabs`, `sheet`, `button`,
`skeleton` already exist under `frontend/src/components/ui/`.

---

## 6. Build phases (each independently shippable, phase-commit pattern)

The project ships in numbered, independently-committed phases with a DEVLOG entry
and tests each (DEVLOG cadence). Five phases, MVP-first:

**Phase K1 — Episodic logging only (MVP).**
Schema for `run_episodes` only. `server/knowledge/episode-recorder.js` with
`recordEpisodeForRun(runId)` wired into the three terminal branches in
`server/index.js`. Deterministic `outcome` from existing synthesis. Read-only
`GET /api/knowledge/episodes`. No UI beyond a JSON route + tests. Fully passive —
zero behavior change to running agents. *Ships value: a queryable run-episode log.*

**Phase K2 — Retrieval + Knowledge UI (read).**
Add `renderRetrievedKnowledgeBlock` to `buildSystemPrompt` (episodes only at first),
the `/knowledge` React page (Episodes tab), `phantom_recall_skill` read tool. Scope-
aware retrieval (§4.2). *Ships value: past runs now inform new-run planning.*

**Phase K3 — Skill extraction (heuristic, candidate-only).**
`learned_skills` schema + heuristic distiller in `episode-recorder.js` (trace →
candidate skill, `status='candidate'`). Skills tab in UI with **Approve/Retire**
operator gate (§4.3). Skills join retrieval once `approved`. Trust digest via
`manifest-signer.js`. *Ships value: reusable playbooks under operator control.*

**Phase K4 — Failure reflection + LLM enrichment.**
`failure_reflections` schema + heuristic classifier. Add the flagged
`knowledge_llm_enabled` enrichment path (skill `name/description` generalization +
reflection `why/try_next`), reusing the `enrichSynthesisWithLLM` injected-LLM
pattern. Reflections tab. *Ships value: the agent avoids prior dead-ends.*

**Phase K5 — Quality loop + (optional) semantic retrieval.**
Wire `use_count`/`success_count` updates when an approved skill's replay run lands
`completed`; auto-retire skills whose success ratio decays. Optional
`embedding_json` semantic ranking if keyword retrieval proves insufficient.
Optional skill export into the signed registry shape. *Ships value: self-pruning,
higher-precision recall.*

---

## 7. Risks & open questions

**Prompt-injection-via-memory (most serious — it's a security tool).** A poisoned
episode or distilled skill could steer future runs (e.g. a run that scraped an
attacker-controlled page whose content lands in `summary` and later re-enters a
prompt as "recall"). Mitigations: (a) episodes store **pointers + redacted summary**
via the existing `evidence-redactor.js` last-line scrubber, not raw tool output;
(b) skills require an **operator promote gate** before becoming retrieval-eligible
(§4.3) — the human is the firewall; (c) retrieved knowledge is injected as clearly-
delimited *advisory* text **above** the governance block, never as tool definitions
or scope; (d) the executor gate is the final backstop — recalled text can suggest
but cannot authorize. Open question: do we additionally run a redaction/sanity pass
over distilled skill text on promotion?

**Learned-skill ↔ signed-registry interaction.** Skills name tools; if a toolpack is
later revoked (B4 revocation poller, `server/registry/revocation-poller.js`,
`checkRevoked`), a skill referencing a revoked tool should be flagged/retired.
Open question: should `recordEpisodeForRun` or retrieval consult `checkRevoked` and
suppress skills whose tools are revoked? (Recommended: yes, at retrieval time.)

**Storage growth.** One episode per run is bounded by run volume, but
`tool_sequence_json` + reflections accumulate. Mitigation: cap stored sequence
length (like the synthesis enrichment's last-20-events window, synthesis.js line
431) and a retention setting; episodes `ON DELETE CASCADE` with runs so DB cleanup
propagates. Open question: retention default (e.g. keep all episodes, prune
candidate skills after N days unpromoted?).

**Bundle / perf.** Write path is best-effort and off the hot path (fires after
`exportTraceArtifact`), and the heuristic core is pure synchronous SQLite reads —
no perf risk at MVP. The LLM enrichment is async + flagged-off by default, so it
never blocks run finalization. The React Knowledge page is one more lazy-loadable
route; no new heavy deps (no embedding lib unless K5 opts in).

**Multi-scope leakage.** An episode learned under a permissive lab scope must not
quietly seed a run under a stricter production scope. Retrieval filters by scope +
intersects required actions (§4.2), but cross-scope episode display is read-only
and origin-labeled. Open question: should retrieval be scope-*exact* by default
with an operator opt-in to cross-scope recall?

**Determinism vs. LLM drift.** Keeping `outcome`, `failure_kind`, and the skill
*shape* deterministic (LLM only writes prose/labels) preserves the project's
"deterministic-first, LLM-enrichment-flagged" invariant (goal-evaluator + synthesis
both follow it) and prevents the model from gaming its own memory — the same
concern goal-progress.js line 9 calls out ("so the agent can't game it").
