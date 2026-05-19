# Approvals queue

The **Approvals page** is PHANTOM's single governance surface. Every privileged action — whether it's a scope-gated tool call, an allow-once bypass, an operator override, an approval-timeout, or a pending sec-ops install request — surfaces here.

## What's on the page

**Pending install requests (top)** — sec-ops installer requests awaiting approval, rendered as their own card kind:

- Status pill (`pending`)
- Tool ids and command preview
- **Approve & install** and **Cancel** buttons
- Status syncs with Settings → Tools — approving here updates both surfaces

**KPI strip** — Total events, Granted, Denied (with timeouts), Allow-once, Override, Approve rate.

**Activity sparkline (14 days)** — daily count of all approval events.

**By-risk breakdown** — proportional bars for each action class observed.

**Filter bar** — Decision (Granted / Denied / Allow-once / Override / Timeout), Risk class, Since date.

**Event list** — every approval event reconstructed from `trace_events`. Each row expands to show:

- Decision label with color
- Tool name, risk class, scope name, time
- Reason (policy explanation)
- Operator note (whatever you typed when approving/denying)
- Policy mode (`governed` / `operator-override` / `allow-once`)
- Gate (`ask`, `implicit-deny`, etc.)
- Args preview
- Open-run link to jump to that run's trace

## The five decisions

| Decision | Trace event type | Meaning |
|---|---|---|
| `granted` | `tool.call.approval.granted` | Operator approved an ask-gate. Tool ran normally. |
| `denied` | `tool.call.approval.denied` | Operator denied an ask-gate or implicit-deny allow-once card. Tool did not run. |
| `allow-once` | `tool.call.approval.granted` with `kind: 'allow-once'` (or `tool.call.allow-once`) | Operator granted a one-time exception to an implicit deny. Tool ran with `policyMode: 'allow-once'`. |
| `override` | `tool.call.override` | Operator Override is active; the call bypassed scope gates entirely. |
| `timeout` | `tool.call.approval.denied` with note containing `timed out` | Approval window expired (5 minutes). Tool did not run. |

The Approvals view is **reconstructed from `trace_events`** — no separate approval table. That means:

- The audit trail and the operator view are the same data.
- Approval history doesn't drift from run history.
- Filtering by run, scope, tool, or decision just walks the trace events.

## Pending install requests vs. completed runs

The page deliberately separates **action-needed** items (top) from **history** (bottom). Pending install requests are the only thing that requires you to do something right now; everything below the KPI strip is audit.

When you approve an install request, it disappears from the top section and the resulting `installer.step.*` trace events flow into the same trace store, but the install isn't surfaced as a separate event in the bottom list (yet) — that pipe is on the roadmap.

## Batch approval

When operators routinely approve the same risky class against the same scope ("I'm going to do twenty nmap scans of this `/24`, stop asking"), the approval card has a checkbox: **"Approve next N matching"**.

Mechanics:

1. You approve the current card with the batch checkbox ticked and a count.
2. Subsequent ask-gated calls **on the same WebSocket connection** matching `(scopeId, risk)` auto-approve until the count is exhausted.
3. Batch state resets on disconnect — it does not carry across sessions.

Allow-once cards never batch. Only ask-gates do, because batch-bypassing an implicit deny would silently broaden scope.

## Timeouts

If you ignore an approval card for 5 minutes, the executor's pending promise resolves with `{approved: false, note: 'Operator approval timed out (5m)'}` and the tool call is recorded as denied with the timeout note.

The 5-minute window is hardcoded in `server/index.js` (`APPROVAL_TIMEOUT_MS`). If you need a different cadence, file an issue — we'd want to make it configurable per scope rather than globally.

## Filter URLs

The Approvals page accepts query params for filtering — useful when you're linking to a specific view from a postmortem.

```text
/api/approvals?decision=denied&risk=exploit&since=2026-05-01T00:00:00Z
```

`decision`, `risk`, `scopeId`, `toolName`, and `since` are all honored.

## Why everything is in one place

The earlier design had:

- Scope-gated approvals on the chat page (good — it's where the action is)
- Install requests in Settings → Tools (siloed — the operator who's about to approve doesn't necessarily live in Settings)
- Operator override decisions implicitly via the override banner

That fragmented the governance story. The unified queue means there's one URL to put on a runbook ("check the Approvals page before EOD"), one filter bar to triage from, and one audit trail.
