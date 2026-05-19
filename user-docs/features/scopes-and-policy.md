# Scopes & policy gates

A **scope** is PHANTOM's authorization boundary. It defines what targets the agent can touch and what classes of action it's allowed to take. Every risky tool call is evaluated against the active scope **before** it executes.

## What's in a scope

| Field | Purpose |
|---|---|
| `name` | Human-readable label (shown in the topbar chip, run header, audit trail). |
| `targets` | `{ hosts, cidrs, urls, domains }` — the actual systems in-bounds. |
| `action_modes` | Per-action-class mode: `auto` (runs), `ask` (operator approval first), `deny` (forbidden). |
| `allowed_actions`, `blocked_actions` | Legacy fields, still honored if `action_modes` is empty. |
| `active_hours` | Optional time windows during which the scope is active. |
| `blackout_windows` | Inverse — periods when the scope is *not* active even within active hours. |
| `rate_caps` | `requests_per_minute` and `max_actions_per_run` to prevent runaway scans. |
| `rules_of_engagement` | Free text — surfaced in the system prompt verbatim. |
| `expires_at` | Auto-archive timestamp. Expired scopes block everything. |
| `credential_refs` | Pointers to credentials (vault keys, asset ids) — never raw secrets. |

You can build scopes from scratch on the Scope page, or start from a **Rules-of-Engagement template** (internal pentest, bug bounty, red team, lab/internal — same templates the onboarding wizard uses).

## Action classes

PHANTOM classifies every tool call into one of these classes before gating:

| Class | Examples |
|---|---|
| `read/local` | `read_file`, `list_directory`, local file lookups |
| `recon` | `dig`, `whois`, `subfinder`, passive OSINT |
| `network-scan` | `nmap`, `httpx`, `nuclei`, `ffuf` (probe-style) |
| `exploit` | `sqlmap`, `metasploit`, weaponized payloads |
| `destructive` | anything that deletes, drops, formats, or overwrites |
| `credentialed` | tools that use stored credentials |
| `offline-password-audit` | `john`, `hashcat`, `hashid` — local hash material only |
| `online-bruteforce` | `hydra`, `medusa`, `ncrack` — live login attempts |
| `unknown` | a call the classifier can't place — denied by default |

These classes are deliberately granular. Splitting `offline-password-audit` from `online-bruteforce` (added during the password-audit capability split) means you can authorize local hash cracking without authorizing live login attempts. The toolpacks honor the same split.

## The four outcomes

Given a tool call and a scope, the policy evaluator returns one of four outcomes:

- **auto** — runs immediately. No approval card, no pause.
- **ask** — the agent's call pauses. An approval card appears in chat with the tool name, args preview, risk class, reason, and a note field. Operator approves or denies. The decision lands in the audit trail.
- **deny (explicit)** — the operator listed this action class as forbidden. The call does not run; a `tool.call.blocked` trace event is recorded with the policy reason.
- **deny (implicit)** — outside scope, expired, off-hours, rate-cap hit, etc. PHANTOM offers the operator a one-time **Allow once** card instead of a hard block.

Implicit denies are the safety valve. If a scope is well-defined but the agent reaches for something *just* outside the boundary, the operator can grant a single bypass without rewriting the scope.

## Gate flow in the system prompt

The system prompt's `## CURRENT UI CONTEXT` block tells the agent which action classes are `auto`, `ask`, or `deny` for the active scope. The agent uses this to **predict** approval requirements and emit a **pre-flight plan** before chaining multiple ask-gated calls — so the operator sees "I'm about to do X, Y, Z; X needs approval" *once* instead of getting hit with three separate cards.

The prompt also enumerates the four outcomes verbatim and instructs the agent to:

1. Treat ask-gates as deliberate handshakes, not failures.
2. Never retry a denied call.
3. Pivot when explicit-deny — propose a less-risky alternative.

## What "blocked" looks like

When the policy says no, you don't see an error. You see a `tool.call.blocked` event in the run's trace timeline with:

- The tool name and args
- The risk class
- The policy reason ("out of scope", "scope expired", "rate-cap reached", etc.)
- The targets that triggered the block

The agent continues — usually by acknowledging the block and pivoting. The synthesis card's highlights section will surface "N actions blocked by scope policy" as a risk note.

## Dry-run validation

The Scope Builder lets you test a proposed command against your draft scope **before** saving. Type `nmap 10.0.0.1` into the dry-run field; the builder shows whether that exact call would be allowed or blocked and why.

This is also exposed as an API:

```bash
POST /api/scopes/evaluate-draft
{
  "scope": { "name": "Draft", "targets": {…}, "allowedActions": ["recon"] },
  "toolName": "execute_command",
  "args": { "command": "nmap 10.0.0.1" }
}
```

Useful when you're iterating on a scope and want to know if it'll permit the workflow you have in mind.

## Rate caps

`scope.rate_caps` enforces two ceilings:

- `requests_per_minute` — sliding window of recent actions; blocks new actions above the cap.
- `max_actions_per_run` — absolute ceiling per run; blocks everything after the limit.

The rate limiter lives at `server/scope/rate-limiter.js` and runs on every allowed action. A breach surfaces as an implicit-deny ("rate cap reached for this scope") which the operator can allow-once or accept.

## Best practices

- **Start narrow.** A scope of one host or `/29` is easier to expand than a `/16` is to tighten.
- **Use ROE templates.** Internal Pentest, Bug Bounty, Red Team, and Lab/Internal templates ship with sane defaults.
- **Set `expires_at`.** Engagements end. A scope that auto-archives prevents stale authorization.
- **Don't reuse scopes across engagements.** Each scope is an audit boundary — make a new one per engagement, archive when done.
- **Use Operator Override only for lab work.** It bypasses the gates but records the bypass. See [Operator Override](/features/operator-override).
