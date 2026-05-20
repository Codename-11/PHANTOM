# AI Sync - Security

## Deployment shape

Production deployment is Docker-on-Linux (see `ai_sync/containerization.md`). PHANTOM ships as a single `debian:stable-slim` image with Node 20 + Python + Go inside; SQLite + WAL/SHM live on the `phantom-db` named volume and the workspace lives on `phantom-workspace`, so `docker compose down` is non-destructive. The multi-backend installer in `server/tools/installer.js` (winget/choco/scoop/wsl-apt/brew) stays for dev-on-Windows but is **not** load-bearing in production — production trusts `PHANTOM_BACKEND=apt` (set via Dockerfile or env) and the install path runs only `apt + pipx + go` inside the container. Windows and macOS are dev-only environments; native installs there exist to make iteration fast, not to be deployment targets.

## What we have

- Local SQLite storage for settings, conversations, runs, trace events, artifacts, scopes, prompt profiles/fragments, assets, findings, snapshots, rerun templates, comparisons, and **install requests**.
- Policy-gated tool execution for governed runs:
  - Extracts target hints such as URL, IP, domain, host, CIDR, and host:port from tool arguments.
  - Classifies risky actions into policy classes such as `read/local`, `recon`, `network-scan`, `exploit`, `destructive`, `credentialed`, `offline-password-audit`, `online-bruteforce`, and `unknown`.
  - Separates `offline-password-audit` from `online-bruteforce` so local John/Hashcat/hash workflows can use wordlists without authorizing live login attempts.
  - Blocks expired scopes, explicit denials, missing allowlist permissions, unknown risky actions, and out-of-scope targets before execution.
  - Persists blocked actions as `tool.call.blocked` trace events so audits can prove the command/request did not run.
  - Supports per-run **Operator Override** for local testing/fixtures; override bypasses scope gates but still records risk classification, redacted reason metadata, and a `tool.call.override` trace before execution.
  - Supports `ask`-gated actions with an approval round-trip over the WebSocket (5-minute auto-deny on timeout), plus implicit-deny `allow-once` cards for one-time exceptions. Batch-approval state ("approve next N matching") is per-connection and resets on disconnect by design.
- **Agent loop iteration cap** (`MAX_AGENT_ITERATIONS = 40` in `server/ai/llm-client.js`) bounds a pathological model from spinning indefinitely. Stuck-state guard exits cleanly when the model returns empty content + empty tool_calls. `finish_reason: 'length'` surfaces a max_tokens hint instead of looping.
- Scope CRUD and archive support for authorization boundaries, rules of engagement, expiry, allowed/blocked action classes, target lists, and redacted credential references.
- Prompt profiles/fragments with profile/scope/toolpack-aware prompt resolution and redacted per-run snapshots.
- Curated security toolpacks with risk classes, scope requirements, install hints, availability checks, policy metadata, blocked-by-default classes, Basic/Kali capability levels, and prompt fragments. Each toolpack card now decorates its tools with green/red availability dots driven by the same installer detection used elsewhere.
- **Sec-Ops Installer governance** — installing system tools is an approval-gated, persisted, traced action:
  - 23-tool catalog (`server/tools/installer-catalog.js`) covering base recon/OSINT, offensive red-team, and blue defense/DFIR tiers with per-backend package ids for winget, choco, scoop, apt, dnf, pacman, brew, pipx, go.
  - Host detection (`detectHost`) walks `process.env.PATH` for each candidate package manager + reads `/etc/os-release` + probes `/.dockerenv`. No shell-outs.
  - Install plans resolve to exact `(command, args)` pairs and are persisted to the new `install_requests` table before any execution.
  - Approval is operator-driven from either Settings → Tools or the Approvals page (single governance queue).
  - Each step runs via `spawn(cmd, args, { shell: false })` — no shell injection surface. Per-step timeout (10 min cap), captured stdout/stderr tails (4KB each) persisted into the request's result column for audit.
  - **Privilege-failure classification** — `classifyResult` matches a conservative pattern set ("must be root", "Access is denied", "sudo: a password is required", "Operation not permitted", winget `0x80073D06`, choco MSI `1603`) and labels failures as `admin` instead of generic `failed`. Linux cached sudo password (from `/api/sudo/validate`) is piped to `sudo -S` stdin so non-TTY installs work; Windows admin failures surface a `Start-Process -Verb RunAs …` copy-command affordance.
- **System-prompt host context** — `getInstallerStatus()` injects an `## INSTALLED SEC-OPS TOOLS ON HOST` block grouped by tier so the agent reaches for binaries that exist on PATH rather than hallucinating tool names. Refreshes on every prompt build.
- **LLM-synthesis enrichment** (flagged, default off) replaces the heuristic synthesis highlights/nextSteps with LLM-generated content keyed to the actual trace. Enum-validated payload; any failure falls back to the heuristic synthesis silently — the agent's stability never depends on this call succeeding.
- Run replay bundles expose redacted scope/profile/toolpack metadata plus trace completeness, blocked counts, artifacts, and graph context.
- Skill deletion route sanitizes path input with `path.basename` to avoid path traversal.

## What we want

- Richer policy explanation diffs in the UI showing exactly which target/risk rule matched.
- Prompt fragment version history, reset-to-default, and safer rollback controls.
- Structured tool observations so policy and graph derivation rely less on text scraping.
- Stronger command-injection detection for shell-adjacent tool invocations before the policy gate.
- Exportable authorization/audit packets for reports without leaking secrets.
- Per-installer-step rollback/uninstall verb so an aborted install can be cleaned up reproducibly.
- Cache LLM-synthesis enrichment per-run rather than regenerating on each fetch.

## What is done

- Governed Runs substrate is implemented and tested with Node's built-in test runner.
- Risky tool actions are evaluated before execution; blocked actions are persisted and visible in Runs/Graph.
- Operator Override is available per run for local testing without scope, with redacted audit metadata and explicit `tool.call.override` events.
- Scopes, prompt profiles/fragments, toolpacks, run snapshots, and redaction surfaces are available through REST APIs and the vanilla JS UI.
- Settings now shows populated Security/Scope and Tools/MCP/Skills admin panels instead of empty placeholders.
- Approval queue is implemented: ask-gates + allow-once + operator override + timeout, with the Approvals page surfacing every decision plus pending install requests in one queue.
- Agent loop tolerates Grok-style `finish_reason: 'stop'` paired with `tool_calls` deltas; multi-step engagements complete instead of one-and-done'ing on round one.
- Sec-Ops installer is governed end-to-end: detection → catalog → plan → approval → traced execution → privilege classification → audit trail.
