# AI Sync - Security

## What we have

- Local SQLite storage for settings, conversations, runs, trace events, artifacts, scopes, prompt profiles/fragments, assets, findings, snapshots, rerun templates, and comparisons.
- Policy-gated tool execution for governed runs:
  - Extracts target hints such as URL, IP, domain, host, CIDR, and host:port from tool arguments.
  - Classifies risky actions into policy classes such as `read/local`, `recon`, `network-scan`, `exploit`, `destructive`, `credentialed`, and `unknown`.
  - Blocks expired scopes, explicit denials, missing allowlist permissions, unknown risky actions, and out-of-scope targets before execution.
  - Persists blocked actions as `tool.call.blocked` trace events so audits can prove the command/request did not run.
- Scope CRUD and archive support for authorization boundaries, rules of engagement, expiry, allowed/blocked action classes, target lists, and redacted credential references.
- Prompt profiles/fragments with profile/scope/toolpack-aware prompt resolution and redacted per-run snapshots.
- Curated security toolpacks with risk classes, scope requirements, install hints, availability checks, policy metadata, blocked-by-default classes, and prompt fragments.
- Run replay bundles expose redacted scope/profile/toolpack metadata plus trace completeness, blocked counts, artifacts, and graph context.
- Skill deletion route sanitizes path input with `path.basename` to avoid path traversal.

## What we want

- Optional approval queue for high-risk actions that should pause a run instead of hard-blocking.
- Richer policy explanation diffs in the UI showing exactly which target/risk rule matched.
- Prompt fragment version history, reset-to-default, and safer rollback controls.
- Structured tool observations so policy and graph derivation rely less on text scraping.
- Stronger command-injection detection for shell-adjacent tool invocations before the policy gate.
- Exportable authorization/audit packets for reports without leaking secrets.

## What is done

- Governed Runs substrate is implemented and tested with Node's built-in test runner.
- Risky tool actions are evaluated before execution; blocked actions are persisted and visible in Runs/Graph.
- Scopes, prompt profiles/fragments, toolpacks, run snapshots, and redaction surfaces are available through REST APIs and the vanilla JS UI.
- Settings now shows populated Security/Scope and Tools/MCP/Skills admin panels instead of empty placeholders.
