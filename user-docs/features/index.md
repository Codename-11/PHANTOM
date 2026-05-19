# Features

PHANTOM's features are organized around two ideas: **operator surfaces** (what you look at and click on) and **governance surfaces** (how the system stays auditable). Every feature in the list below is wired through one or both.

## Operator surfaces

| Feature | What it does |
|---|---|
| [End-of-run synthesis card](/features/synthesis-card) | One-glance posture, objective, activity, highlights, next steps after every terminal run. |
| [Posture trending](/features/posture-trending) | Dashboard sparkline + by-scope breakdown + recent-runs timeline using the same data shape as the per-run card. |
| [Sec-Ops installer](/features/sec-ops-installer) | Detect the host package manager (winget · choco · scoop · apt · dnf · pacman · brew · wsl-apt) and install base/offensive/blue tooling via approval-gated commands. |

## Governance surfaces

| Feature | What it does |
|---|---|
| [Scopes & policy gates](/features/scopes-and-policy) | First-class authorization boundaries — targets, action classes, ROE, expiry, rate caps. Risky calls evaluate against the active scope before they execute. |
| [Approvals queue](/features/approvals) | One audit dashboard for scope-gated ask events, allow-once cards, operator overrides, timeouts, and pending sec-ops install requests. |
| [Operator Override](/features/operator-override) | A deliberate-ceremony toggle that bypasses scope gates for local lab testing while still classifying risk and persisting the override audit trail. |

## What's covered elsewhere

Some surfaces are well-explained inside the app itself and don't have dedicated pages here yet — Toolpacks (Settings → Tools), Prompt profiles & fragments (Settings → Prompts), Graph replay (the page is self-describing), Artifacts. If you want deep-dive docs on any of those, open an issue.
