# PHANTOM Glossary

A reference for the operator-facing vocabulary used across PHANTOM's
UI, API, and docs. When you encounter a term in the cockpit, this is
the canonical definition.

---

## Run

A single governed execution from PHANTOM's AI agent. Each run records:

- The **goal** (operator prompt or campaign-derived objective).
- An immutable **prompt snapshot** (system prompt, profile, fragments,
  scope policy at start).
- A complete **trace** of every tool call, policy decision, finding,
  and artifact.
- A terminal **status** (`running` / `completed` / `failed` /
  `stopped`).

Runs are the unit of replay, audit, and evidence export. Every action
the agent takes resolves into a run.

---

## Conversation

The chat thread that drives one or more runs. A conversation is the
container; runs are the bounded units of work spawned inside it.

---

## Goal (v0)

A persistent objective injected into the agent's system prompt during
a conversation. Used for short-term context — "what are we working on
right now?" Single-active by design. See also **Campaign Goal**.

## Campaign

A scoped, governed multi-run objective. PHANTOM acts as the
supervisor: it owns the goal queue, budgets, scope policy, and the
evaluator that decides what happens after each child run.

- Statuses: `draft` → `queued` → `running` → `paused` /
  `needs_approval` → `completed` / `failed` / `canceled`.
- Each campaign has a list of **Campaign Goals** that run in priority
  order. Each goal spawns one or more child **Runs** via a worker
  backend.
- Worker backends: `phantom-native` (in-process, default), `codex-exec`
  (Codex CLI in a sandboxed working directory).

## Campaign Goal

One unit of work inside a campaign — a prompt + completion criteria
+ priority + attempt cap. The evaluator decides after each linked run
whether to `complete`, `retry`, `pause`, `needs_approval`, `branch`,
`next_goal`, `continue`, or `fail`.

## Evaluator

The decision module that runs after every campaign-linked child run
finalizes. It reads the run's trace + artifacts + findings and
returns a structured verdict that updates the campaign goal status.

---

## Scope

The operator-defined boundary that says **what PHANTOM may touch**.
A scope contains:

- **Targets** (hosts, CIDRs, URLs, domains).
- **Allowed action classes** (e.g. `recon`, `network-scan`).
- **Blocked action classes** (e.g. `exploit`, `destructive`).
- **Action modes** (`auto` / `ask` / `deny`) per action class.
- Optional **expiration**, **rate caps**, **active hours**, **ROE
  notes**.

No tool call lands without a scope check. Scope is the first-class
governance primitive — everything else (campaigns, runs, policy
gates) reads from it.

## Risk Class

A classification of how dangerous an action is, applied per-tool:

- `read/local` — workspace I/O, file reads.
- `recon` — DNS, whois, web requests, certificate transparency.
- `network-scan` — nmap, masscan, vulners.
- `web-vuln` — sqlmap (detection mode), nuclei, ffuf.
- `offline-password-audit` — hashcat, john on local hash files.
- `credentialed` — auth probes with stored creds.
- `online-bruteforce` — hydra, medusa, ncrack.
- `exploit` — msfconsole, payload execution. **Locked / denied.**
- `destructive` — INSERT/UPDATE/DELETE, file writes to targets.
  **Locked / denied.**

## Action Class

Lower-level classification of what a tool does (`tool.web_request`,
`tool.shell.exec`, `install.apt`, etc.). Action classes feed into
risk classes.

---

## Asset

A host, service, or workspace target that PHANTOM tracks across runs.
Assets have:

- **Type** (host / web-host / api-host / database / server /
  workstation / vpn-gateway / etc.).
- **Addresses** (IPv4 / IPv6 / domain).
- **Services** (port + protocol + service name).
- **Criticality** (low / medium / high / critical).
- **Tags** for filtering.
- **Findings + snapshots** (history of issues + posture over time).

## Finding

A discovered issue against an asset — severity (`info` / `low` /
`medium` / `high` / `critical`), title, description, recommendation,
and a triage status. Findings can be linked to the run + scope that
surfaced them.

---

## Toolpack

A policy-aware bundle of security tools — for example `web-recon` or
`offline-password-audit`. Toolpacks declare:

- Their **tools** (the callable units).
- The **risk class** of each tool.
- Whether a tool is **gated** (requires explicit operator approval).
- The **install recipe** (declarative, never shell strings).
- A **manifest** (`toolpack.phantom.dev/v1`) that the registry uses.

## Profile

A named selection of toolpacks + tools tuned for a specific operator
workflow (e.g. "Cautious Recon" or "Active Probe"). Profiles control
which tools are visible + invokable inside a given run/campaign.

## Manifest

The signed metadata contract for a toolpack
(`toolpack.phantom.dev/v1`). Manifests **describe** capability; they
never execute it. PHANTOM verifies the digest + signature before
import.

## Registry source

An operator-configured remote URL PHANTOM may fetch signed manifests
from. Each source carries a pinned ed25519 trust root (base64 raw
32-byte public key). Sources land **disabled** by default; the
operator must explicitly enable browsing. HTTPS-only by policy.
Channels: `stable` / `preview` / `dev`. See `user-docs/reference/registry.md`
for the full operator flow.

## Signature status

The verification state of a single manifest or revocation feed against
the configured trust roots. One of:

- `unsigned` — no `trust.signature`, OR the digest is a placeholder
  (e.g. `sha256:0000...`). All current built-in fixtures fall into
  this bucket.
- `unknown_signer` — signature present, but `signed_by` does not
  match any configured trust root.
- `verified` — signature + `signed_by` both validate against a
  configured trust root.
- `invalid` — signature decodable but verification against the
  named root fails (tampered body, wrong key, etc.).

## Revocation feed

A signed `phantom.revocations/v1` JSON document published by a
registry source listing package versions that should be warned or
blocked. PHANTOM polls every enabled source's feed every 30 minutes
and caches the parsed entries in-process. Severities: `warn` (UI
banner; install allowed with acknowledgement) and `block` (install
denied until pinned replacement is selected or an operator override
is approved).

## Trust root

A pinned base64-encoded ed25519 raw 32-byte public key associated
with a registry source. Used to verify the source's signed catalog +
revocation feed. PHANTOM ships no default trust roots — operators
choose what to trust.

---

## Approval

A pending operator decision required before a high-risk action
proceeds. Approval types:

- **Scope ask** — agent wants to take an action that needs scope
  expansion or operator confirmation.
- **Install** — toolpack/profile install request.
- **Registry** — package import / update / rollback / remove.
- **Elevated** — a command needs sudo / admin / root.

Each approval shows: target, risk class, action class, policy reason,
expected effect, side effects, and a raw-details disclosure.

## Operator Override

A scoped, time-bounded bypass of governance gates for one run.
Recorded as a trace event; never silent. Used when an operator needs
to test against a target outside the active scope and accepts the
audit trail.

---

## Artifact

Any persistent file PHANTOM writes during a run — reports, evidence
bundles, traces, screenshots, parsed tool output. Artifacts are
addressable by ID and downloadable.

## Evidence Bundle

A reviewable rollup of a campaign or run — campaign / goals / linked
runs / artifacts / findings / policy decisions / budget summary —
exportable as a zip with one folder per child run plus a
self-describing `campaign.json` + `report.md`.

## Replay

The reconstruction of a run's execution from its trace events.
Operators can step through the trace, inspect each policy decision,
and watch the run replay in deterministic order. Campaign replay
aggregates the same view across every linked child run.

---

## Diagnostics

The bounded readiness probe surfaced at `/api/diagnostics` and on the
Dash readiness card. Each component (runtime, DB, workspace,
provider, docs, toolpacks, campaigns) reports `ok` / `needs_setup` /
`degraded` / `blocked` with redacted detail.

## Onboarding Checklist

The five-item state-driven checklist on Dash that walks a new
operator through setup: install toolpacks → add an asset → draft a
scope → run a governed task → optionally load the demo scenario.

---

## Demo Data

PHANTOM ships a synthetic demo seed (`npm run seed` or the
**Load demo scenario** button) that populates realistic-looking
scopes / assets / findings / runs / artifacts so the cockpit isn't
empty on a fresh install.

Every demo row is unmistakable:

- **Names** are prefixed with `[demo]`.
- **Metadata** has `demo: true`.
- The UI shows a **`Synthetic demo data`** watermark on rows tagged
  this way.

Demo data never executes tools and never reaches real targets. Clear
it any time via the **Clear demo data** link on the Dash checklist
or `npm run seed:reset`.

---

## Trace Event

A single auditable line in a run's execution. Common types:

- `run.started`, `run.completed`, `run.failed`
- `tool.call.started`, `tool.call.completed`, `tool.call.failed`,
  `tool.call.blocked`
- `policy.decision`, `scope.evaluation`
- `finding.recorded`, `artifact.created`
- `goal.started`, `goal.completed`, `goal.evaluated`,
  `goal.needs_approval`
- `worker.spawned`, `worker.budget_exhausted`
- `campaign.started`, `campaign.paused`, `campaign.completed`,
  `campaign.failed`, `campaign.canceled`

Trace events are append-only and form the basis of replay + audit
exports.

---

_This glossary is maintained alongside the
`docs/plans/2026-05-20-phantom-mega-plan.md`. Add new terms here when
they land in the UI._
