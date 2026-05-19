# Governance model

PHANTOM's governance contract is short: **classify every risky action, gate it on scope policy, persist every decision as a trace event, never silently broaden authority.**

This page is the technical complement to the user-facing [Scopes & policy gates](/features/scopes-and-policy) feature page. Here we cover the action-class taxonomy, the policy evaluator's contract, and the trace event vocabulary.

## Action classes

Every tool call extracts target hints (URL, IP, domain, CIDR, host, port) and gets classified into one of these action classes. The class determines which scope rules apply.

```text
read/local              — local file reads, listings, no network
recon                   — passive: dig, whois, subfinder, theHarvester
network-scan            — active probing: nmap, httpx, ffuf, nuclei
exploit                 — sqlmap, metasploit, payload delivery
destructive             — deletes, drops, overwrites, formats
credentialed            — uses stored creds
offline-password-audit  — local hash + wordlist; john, hashcat, hashid
online-bruteforce       — live login attempts; hydra, medusa, ncrack
unknown                 — classifier couldn't place — implicit deny
```

The split between `offline-password-audit` and `online-bruteforce` (added during the password-audit capability split) is important: local hash cracking can be authorized without authorizing live login attempts. The toolpacks honor the split.

## The policy evaluator

`evaluateToolAction({toolName, args, scope, operatorOverride, usage})` is the single function that decides every gate. Its contract:

**Input.**

- `toolName` + `args` — the proposed call.
- `scope` — the active scope (or `null` for unscoped calls).
- `operatorOverride` — `{enabled, reason, expires_at}` if active.
- `usage` — current rate-cap counters (per scope + per run).

**Output.**

```ts
{
  allowed: boolean,
  mode: 'auto' | 'ask' | 'deny',
  explicit: boolean,        // if mode === 'deny': did the scope explicitly deny this class?
  risk: ActionClass,
  reason: string,           // policy explanation
  targets: string[],        // extracted target hints
  policyMode?: 'operator-override' | 'allow-once',
  operatorOverride?: {...},
  gate?: string             // 'ask', 'implicit-deny', 'expired', 'rate-cap', etc.
}
```

The evaluator is **pure** — given the same inputs, it returns the same output. It does not write to the database, does not log, does not call other services. That makes it trivially testable and explicit about what it considers.

## The four outcomes

| Outcome | Returned `mode` + `allowed` | What happens |
|---|---|---|
| Auto | `{mode: 'auto', allowed: true}` | Tool runs. Trace events: `tool.call.started`, `tool.call.completed`. |
| Ask | `{mode: 'ask', allowed: false}` | Tool pauses. Executor calls `options.requestApproval(...)`. If approved, the decision is re-shaped to auto with `policyMode: 'allow-once'`. Trace events: `tool.call.approval.requested`, then `.granted` or `.denied`. |
| Explicit deny | `{mode: 'deny', allowed: false, explicit: true}` | Tool does not run. The scope listed this class as forbidden. Trace event: `tool.call.blocked`. The chat agent is instructed not to retry. |
| Implicit deny | `{mode: 'deny', allowed: false, explicit: false}` | Tool pauses. Executor offers an allow-once card. If allowed, the call runs with `policyMode: 'allow-once'` and the rule is bent for this one call. Trace events: `.approval.requested`, then `.allow-once` or `.denied`. |

The `explicit` flag is the difference between "we said no" and "we don't have a rule for this." Explicit denies are hard blocks; implicit denies offer a manual escape hatch.

## Trace event vocabulary

Every governed action persists at least one trace event. The full vocabulary:

```text
run.started                     — chat turn begins a run
run.completed                   — model emitted a turn with no tool calls
run.failed                      — exception during the loop
run.stopped                     — user aborted

assistant.chunk                 — one SSE token of model reply text
assistant.thinking              — reasoning/thinking tokens (e.g. DeepSeek)

tool.call.started               — executor begins a tool call
tool.call.completed             — tool returned normally
tool.call.failed                — tool threw or returned an error
tool.call.blocked               — policy refused the call before execution
tool.progress                   — streamed output from a running tool

tool.call.approval.requested    — ask-gate or implicit-deny offer rendered
tool.call.approval.granted      — operator approved
tool.call.approval.denied       — operator denied (or timeout)
tool.call.allow-once            — one-time exception granted
tool.call.override              — operator override bypassed the gate

artifact.created                — durable artifact written
run.rerun.created               — replay triggered a fresh run from a template
```

Approval events are reconstructed into the Approvals page view by querying `trace_events` directly — there's no separate approval table. That keeps the approval audit and the run audit in sync by construction.

## Operator Override semantics

When `operatorOverride.enabled` is true, the evaluator short-circuits at the top of the function:

1. Classification still runs.
2. Target extraction still runs.
3. `allowed: true, mode: 'auto', policyMode: 'operator-override'` is returned.
4. Executor emits a `tool.call.override` trace event before running the tool.

Override is the *only* path that bypasses scope. It is loud, audited, and per-run.

## Rate caps

`scope.rate_caps` has two ceilings:

- `requests_per_minute` — sliding-window cap over `(scopeId, runId)` action counts. Enforced by `server/scope/rate-limiter.js`'s `recordAction` and `getUsage`.
- `max_actions_per_run` — absolute cap per run.

When a cap is hit, the evaluator returns implicit deny with `gate: 'rate-cap'`. The operator can allow-once a single exception or accept the cap.

## Redaction

The prompt resolver and run snapshot writer both pass through a redaction filter (`server/memory/store.js redactSnapshot`) that strips:

- `credential_refs` and `credentialRefs` arrays (replaced with `[REDACTED]`)
- Recognized secret patterns in free-text fields (`operator_override.reason`, scope notes)

Snapshots are persisted in their redacted form. Operators can't accidentally screenshot a run detail page and leak credentials.

## What the agent reads

The system prompt's `## CURRENT UI CONTEXT` block surfaces the active scope's policy verbatim:

- Allowed (auto) action classes
- Approval-required (ask) action classes
- Forbidden (deny) action classes
- Active hours, rate caps, ROE

The agent uses this to **predict** approval requirements and emit a pre-flight plan when chaining 2+ ask-gated calls. The prediction isn't load-bearing — the actual gate still runs server-side — but it makes the pause feel like a deliberate handshake instead of a roadblock.

## Why the gate isn't in the prompt

We don't rely on the agent to refuse. The system prompt strongly instructs it to respect deny outcomes, but the actual block happens in `evaluateToolAction` before the tool runs. If the agent ignored the prompt and called a forbidden tool, the evaluator would still block it server-side and emit `tool.call.blocked`. Prompt compliance is for UX; the gate is for governance.
