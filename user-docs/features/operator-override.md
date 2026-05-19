# Operator Override

Operator Override is a per-run escape hatch for **local lab testing and fixture validation**. When it's on for a run, the scope-policy gates are bypassed before tool execution — but PHANTOM still classifies risk, redacts the override reason, and persists a `tool.call.override` audit trace event for every bypassed call.

It is **not** a "make the agent more capable" mode. It is **not** an authorization grant. It is a clearly-marked, audit-heavy seam for the times when you genuinely don't have a scope and you don't want to write one.

## When to use it

- Running PHANTOM against a brand-new lab VM you stood up five minutes ago.
- Validating a fixture or test setup where defining a scope would be ceremony.
- Reproducing a bug that depends on a specific tool call shape.

## When NOT to use it

- Production engagements. Define a scope.
- Any system you don't own.
- "I keep getting blocked, just turn off the gates."

Override is loud on purpose: a persistent amber banner at the top of every page, a pulsing indicator in the sidebar, and a sticky pill in the run header for any run that executed under override. If you're seeing those during real work, that's a signal to stop and define a scope.

## How it works

**Enabling.** Click the sidebar Operator-Override indicator or hit the chat's Override toggle. A modal opens with:

- A summary of what override bypasses (scope-policy gates before execution) and what it does *not* bypass (risk classification, audit trace events, action-class redaction).
- A required **reason** field. You cannot enable override without typing why you're doing it.
- An expiry — defaults to "this run only," can be set to a longer ceiling if needed.

**While active.** For each tool call:

1. The executor still classifies the action class and extracts target hints.
2. `evaluateToolAction` is called with `operatorOverride: {enabled: true, reason: '...'}`.
3. The evaluator short-circuits: returns `allowed: true, policyMode: 'operator-override', operatorOverride: {...}`.
4. Before running, a `tool.call.override` trace event is recorded with the full operator-override metadata (including the reason).
5. The tool runs.

**Disabling.** Click "End override" in the banner. Override expires immediately. Future tool calls go back through the normal gates.

## What's persisted

For every overridden call, the trace event metadata carries:

- `policyMode: 'operator-override'`
- `operatorOverride.reason` (redacted of obvious secret patterns)
- `operatorOverride.enabled: true`
- `risk` (still classified)
- `targets` (still extracted)
- `decision.reason` ("Operator override bypassed scope policy")

The run's prompt snapshot also flips `governance.policyMode` to `operator-override` so future replays see what mode the run executed under.

## Why classification still happens

Even with override, you want to know *what* the agent did, not just that it ran. If override let the agent do anything without classification, the audit trail would be useless — "operator allowed something" tells you nothing about whether it was a recon call or a destructive one.

By keeping classification + targets + risk class on every override event, the trace stays informative. You can still ask "what destructive actions did this run take?" and get a real answer, even if every gate was bypassed.

## The chat handshake

The agent reads `policyMode: 'operator-override'` from the system prompt's UI-context block and is instructed to:

1. **Announce override-affected actions briefly in chat** — "Override allowed this scan against unscoped target X."
2. **Still prefer the lowest-risk path that satisfies the request.** Override isn't permission to be destructive; it's permission to not have written a scope.
3. **Never use override as an excuse to escalate destructively** or test systems the operator hasn't asked about.

Those instructions are in `server/ai/system-prompt.js` and are part of the prompt's `## OPERATOR OVERRIDE — ACTIVE` block.

## API + flag shape

```json
{
  "operatorOverride": {
    "enabled": true,
    "reason": "Lab smoke test on fresh VM",
    "expires_at": "2026-05-19T18:00:00Z"
  }
}
```

Pass this in the WebSocket `chat` message or POST to `/api/scopes/evaluate-draft` to dry-run a call under override.

## What override does NOT do

- It does not change which tools the agent has access to.
- It does not bypass action-class redaction in the audit trail.
- It does not promote `unknown` actions to allowed — they still need a classifier match.
- It does not silence the `tool.call.override` trace event.

If you want behavior that *isn't* available under override, you probably want to **expand your scope's allowed action classes** instead of broadening override.

## See also

- [Scopes & policy gates](/features/scopes-and-policy) — the system override sits on top of.
- [Approvals queue](/features/approvals) — every override event surfaces here for audit.
