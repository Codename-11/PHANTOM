<div align="center">

# 👻 PHANTOM

### Governed AI Security-Ops Cockpit

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://www.linux.org/)
[![Stack](https://img.shields.io/badge/Stack-Vanilla%20JS%20%2B%20Express%20%2B%20SQLite-26B3FC?style=for-the-badge)](#-architecture)

**A local-first command center for authorized security research with scoped autonomous runs, policy-gated tools, durable traces, artifacts, and graph replay.**

Trace-first runs • Governed scopes • Prompt profiles • Security toolpacks • Durable evidence • Dark operational UI

<img src="https://img.shields.io/badge/Status-Active-22c55e?style=flat-square" />
<img src="https://img.shields.io/badge/Security-Authorized%20Testing-ef4444?style=flat-square" />
<img src="https://img.shields.io/badge/Governance-Policy%20Gated-6366f1?style=flat-square" />

---

</div>

## What PHANTOM Is

PHANTOM started as an AI-powered pentesting command center. It is now evolving into a **governed security-operations cockpit**: every autonomous operation becomes a durable run with trace events, scope context, prompt/config snapshots, optional artifacts, and graph replay.

The guiding idea is simple: powerful tools are useful only when operators can answer:

- What was the agent authorized to touch?
- Which prompt/profile/toolpack drove the behavior?
- Which tool calls actually ran, which were blocked, and why?
- What evidence/artifacts were produced?
- Can the run be reopened, replayed, and audited after refresh or restart?

PHANTOM is intended for **authorized security testing, lab work, research, and defensive validation**. It is not a license to test systems you do not own or have permission to assess.

## ✨ Features

| Area | Capability |
|---|---|
| 🤖 **OpenAI-Compatible LLMs** | Works with OpenAI-compatible APIs including OpenAI, OpenRouter, Ollama, LM Studio, DeepSeek, Claude-compatible proxies, and local routed providers. |
| 🧭 **Governed Runs** | Each user operation creates a run with status, model, scope, prompt/profile metadata, timing, summary, and replayable trace history. |
| 🛡️ **Scopes & Policy Gates** | SQLite-backed scopes define targets, action classes, rules of engagement, expiry, and blocked actions. Risky tool calls are evaluated before execution. |
| 🚫 **Blocked Action Traces** | Expired, denied, unknown-risk, or out-of-scope actions do not execute and are persisted as trace events for auditability. |
| 🧩 **Prompt Profiles & Fragments** | Prompts resolve from base + profile/mode + scope/rules + policy/tool fragments + custom fragments, with redacted snapshots per run. |
| 🧰 **Security Toolpacks** | Curated packs for Passive OSINT, Web Recon, Network Discovery, Web Vulnerability Assessment, Offline Password Audit, and Reporting. |
| 📈 **Runs Timeline** | Historical run list/detail views backed by persisted trace events, artifacts, scope/profile metadata, and policy decisions. |
| 🃏 **End-of-Run Synthesis** | Canonical v1 data shape per run — posture score (coverage/risk/hygiene components), objective met/partial/unmet, highlights, and actionable next steps. Optionally enriched by the LLM (flagged). |
| 📊 **Posture Trending** | Dash-level sparkline + by-scope breakdown of recent run synthesis scores; per-run delta chained across the timeline. |
| 🧭 **First-Run Onboarding** | Wizard auto-opens on a fresh install — provider/key → first scope → preview of the synthesis card before any real run completes. Re-runnable from Settings. |
| 📦 **Sec-Ops Installer** | Auto-detects host package manager (winget/choco/scoop/apt/dnf/pacman/brew/wsl-apt) and installs base + offensive + blue tiers via approval-gated, traced commands with privilege-failure detection. |
| 🕸️ **Graph Replay** | Trace-derived operational graph with pan/zoom, live follow, blocked-path styling, replay controls, readable labels, and output/artifact context. |
| 📦 **Artifacts & Evidence** | Durable workspace-backed previews, reports, summaries, graph snapshots, trace exports, and evidence bundles. |
| 🗂️ **Assets & Scope Builder** | Saved assets, smart target parsing, asset-backed scopes, raw target chips, intent templates, and dry-run policy previews. |
| 🧠 **Memory, MCP & Skills** | Persistent local memory plus MCP server and skill-package management for extended capabilities. |
| ✅ **Approvals Queue** | Single governance surface unifying scope-gated ask events, allow-once cards, operator overrides, timeouts, and pending sec-ops install requests. |
| ⚙️ **Settings/Admin UI** | Dedicated settings tabs for General, Models, Behavior, Prompts, Security/Scope, Tools/MCP/Skills, and Advanced diagnostics. |
| 🎨 **PHANTOM SEC UI Kit** | Vanilla JS frontend with a cool-slate SOC command-center shell, cyan system accent, operator-dense cards/tables, keyboard command palette, responsive admin surfaces, and live WebSocket updates. |

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+
- **npm**
- **Python** 3.10+ for optional smoke tests and some scraping workflows
- An **OpenAI-compatible API endpoint** and key/token, or a local model endpoint

### Installation

```bash
# Clone the maintained fork, or replace with your preferred remote
git clone https://github.com/Codename-11/PHANTOM.git
cd PHANTOM

# Install dependencies
npm install

# Configure your model provider
cp .env.example .env
nano .env
```

### Configuration

Edit `.env` with your provider. Never commit `.env`, API keys, local databases, traces, or workspace output.

```env
# OpenAI-compatible endpoint
API_BASE_URL=https://api.openai.com/v1
API_KEY=[REDACTED]
MODEL_ID=gpt-4o

# Local Ollama-compatible example
# API_BASE_URL=http://localhost:11434/v1
# API_KEY=[REDACTED]
# MODEL_ID=llama3
```

### Run

```bash
npm run dev
```

Open <http://localhost:5173>.

For a production-style local server without the Vite dev process:

```bash
npm run build
npm start
```

## 🏗️ Architecture

```text
PHANTOM/
├── server/                         # Express API + WebSocket backend
│   ├── ai/                         # LLM client (40-iter agent loop) + layered prompt resolver
│   ├── artifacts/                  # Workspace-backed artifact storage
│   ├── assets/                     # Asset registry, findings, snapshots, comparisons
│   ├── e2e/                        # End-to-end smoke driving processMessage → trace → synthesis
│   ├── graph/                      # Trace-derived graph/replay helpers
│   ├── memory/                     # SQLite persistence layer (incl. install_requests table)
│   ├── onboarding/                 # First-run state detection (sticky completion flag)
│   ├── policy/                     # Scope-aware action classification/evaluation
│   ├── prompt/                     # Prompt profiles, fragments, redaction/snapshots
│   ├── routes/                     # REST API endpoints (incl. installer + synthesis + trending)
│   ├── runs/                       # Run replay, synthesis (heuristic + LLM-enriched), trending
│   ├── scope/                      # Scope CRUD, templates, target parsing
│   ├── toolpacks/                  # Governed security toolpack registry
│   └── tools/                      # Tool registry, executor, sec-ops installer catalog/detection
├── frontend/                       # Vanilla JS + Vite UI
│   ├── css/                        # Dark design system (append-only Pass 25-30 for this round)
│   ├── js/
│   │   ├── graph/                  # Graph layout/replay presenters
│   │   ├── pages/                  # Chat, Runs, Graph, Artifacts, Scope, Settings, Approvals,
│   │   │                           #   Trending panel, Installer panel
│   │   ├── scope/                  # Scope Builder target parsing/chips UI
│   │   ├── synthesis-card.js       # Shared render for end-of-run synthesis card + compact row
│   │   ├── onboarding-wizard.js    # First-run wizard (provider → scope → preview)
│   │   └── test-dom-stub.js        # Tiny DOM stub for render-test files
│   └── index.html
├── scripts/                        # Test runner + seed scripts
│   ├── run-tests.js                # Cross-shell runner: unit/e2e/watch modes
│   └── seed.js
├── workspace/                      # Local run traces and generated artifacts
│   └── runs/<run-id>/
│       ├── trace.jsonl
│       └── artifacts/
├── ai_sync/                        # Lightweight repo-local implementation notes
├── tests/                          # Python smoke tests
├── phantom.db                      # Local SQLite database; ignored by git
└── package.json
```

Core runtime flow:

```text
User request
  -> create Run
  -> resolve prompt/config/scope/toolpack snapshot with redaction
  -> model/tool loop
  -> classify risky tool action
  -> scope/policy gate before execution
  -> persist trace event before UI broadcast
  -> derive timeline, graph, artifacts, and replay bundle from persisted data
```

## 🛡️ Governed Runs & Scope Policy

Scopes are first-class authorization boundaries stored in SQLite. A scope can define:

- Raw targets: URLs, domains, hosts, IPs, CIDRs, and host:port values
- Asset-backed targets from the saved asset registry
- Allowed action classes such as `read/local`, `recon`, `network-scan`, `exploit`, `destructive`, `credentialed`, `offline-password-audit`, and `online-bruteforce`
- Explicit blocked action classes
- Rules of engagement notes
- Expiration time
- Redacted credential references

Before risky tool execution, PHANTOM extracts target hints such as URL, IP, domain, host, and port, classifies the action risk, and evaluates it against the selected scope. Blocked actions are returned to the run as policy results and persisted as blocked trace events; they do **not** execute.

For local testing and fixture validation, Chat exposes a per-run **Operator Override** mode. It bypasses scope/target gates for the current run only, but PHANTOM still classifies the action, redacts the override reason, snapshots `policyMode: operator-override`, and persists a `tool.call.override` trace event before execution. Default operation remains governed.

## 🧩 Prompt Profiles & Resolution

Prompts are no longer just one raw mutable system prompt. PHANTOM resolves prompts from layered fragments:

```text
base
  + profile / mode
  + selected scope and rules of engagement
  + policy and toolpack fragments
  + custom fragments
```

Each run stores a redacted prompt/config/scope/toolpack snapshot so operators can inspect what context governed the run later without exposing secrets.

## 🧰 Security Toolpacks

Built-in governed toolpacks provide curated metadata and prompt fragments for common security workflows:

- Passive OSINT
- Web Recon
- Network Discovery
- Web Vulnerability Assessment
- Offline Password Audit — Basic and Kali levels for local hash/wordlist workflows; wordlists are local inputs, not remote scope targets
- Credentialed Service Audit — Basic and Kali levels for authorized, low-rate online service authentication checks against explicitly scoped targets
- Reporting

Toolpacks include availability checks, install hints, input metadata, policy metadata, risk class, scope requirements, output parser names, blocked-by-default classes, capability levels, and playbook prompt fragments.

## 🖥️ Web UI Surfaces

| Page | Purpose |
|---|---|
| **Dash** | Default landing surface — KPI strip, live runs, untriaged alerts, policy decisions, toolpack availability, asset health movers, and the posture-trending panel (sparkline + by-scope + recent-runs timeline). Last-visited route is restored on reload. |
| **Chat** | Main operator control plane with active scope/toolpack selectors, per-run Operator Override for local testing, and live tool output. |
| **Runs** | Historical run list/detail with the **Synthesis** tab as the headline view, followed by Messages, Trace, Graph, Artifacts, Prompt snapshot, and Output. Synthesis lands the canonical v1 data shape (posture, objective, highlights, next-step actions). |
| **Graph** | Trace-derived operational graph with pan/zoom, live follow, replay controls, node detail, policy markers, and artifact links. |
| **Artifacts** | Durable previews, reports, summaries, traces, graph snapshots, and evidence bundles. |
| **Approvals** | Single governance queue — pending sec-ops install requests at the top (approve/cancel inline), KPI strip, 14-day sparkline, by-risk breakdown, and a filterable list of every granted/denied/allow-once/override/timeout event. |
| **Targets / Scope** | Asset registry, saved findings/baselines, Scope Builder, smart target chips, policy dry-runs, and comparisons. |
| **Settings** | General, Models, Behavior, Prompts, Security/Scope, Tools/MCP/Skills (including the **Sec-Ops Installer** with auto-detected host package managers), and Advanced (re-run onboarding wizard, LLM-synthesis toggle). |

## 🛠️ Built-In Tools

The AI can call local tools for shell execution, file operations, web requests/search/scraping, Python execution, preview/artifact creation, memory, trace saving, source editing, MCP integrations, and skills. Tool execution is routed through the executor so governed policy checks can block risky actions before the underlying command or request runs.

Representative tools include:

| Tool | Purpose |
|---|---|
| `execute_command` | Run local shell commands through the policy-gated executor. |
| `read_file` / `write_file` / `list_directory` | Workspace and file operations. |
| `web_request` / `search_web` / `scrape_webpage` / `scrapling_fetch` | Web research and recon workflows. |
| `python_execute` | Execute Python snippets for analysis or automation. |
| `show_preview_window` | Generate durable preview artifacts and live UI previews. |
| `save_memory` / `recall_memory` | Local memory operations. |
| `save_trace` | Persist explicit trace details. |
| `edit_source_code` | Modify PHANTOM source files inside the project boundary. |

## 📋 API Overview

| Endpoint | Method | Description |
|---|---:|---|
| `/api/settings` | GET/PUT | Configuration management. |
| `/api/prompts/preview` | GET | Resolve and preview layered prompts. |
| `/api/prompts/profiles` | GET/POST/PUT | Prompt profile CRUD. |
| `/api/prompts/fragments` | GET/POST/PUT | Prompt fragment CRUD. |
| `/api/scopes` | GET/POST/PUT/DELETE | Scope CRUD and archival. |
| `/api/scopes/templates` | GET | Scope Builder templates. |
| `/api/scopes/parse-targets` | POST | Parse pasted targets into URL/domain/IP/CIDR/host:port chips. |
| `/api/scopes/evaluate-draft` | POST | Dry-run scope policy evaluation before saving. |
| `/api/toolpacks` | GET | List governed security toolpacks. |
| `/api/toolpacks/:id/availability` | GET | Check toolpack dependencies/install hints. |
| `/api/runs` | GET | Run list. |
| `/api/runs/:id` | GET | Run detail with redacted snapshot metadata. |
| `/api/runs/:id/events` | GET | Ordered trace events. |
| `/api/runs/:id/replay` | GET | Replay bundle with run, events, artifacts, graph, and operator steps. |
| `/api/runs/:id/graph` | GET | Trace-derived graph state. |
| `/api/runs/:id/synthesis` | GET | End-of-run synthesis (v1 shape). Accepts `?preview=stub` for onboarding/demo and `?enrich=1` for ad-hoc LLM enrichment. |
| `/api/trending/posture` | GET | Aggregated posture across recent runs — sparkline, by-scope, recent-runs list. Filter by `scopeId`. |
| `/api/artifacts` | GET | Artifact list and filters. |
| `/api/assets` | GET/POST/PUT/DELETE | Saved asset registry. |
| `/api/findings` | GET/POST/PUT | Findings/results linked to assets and runs. |
| `/api/approvals` | GET | Approval audit events (granted/denied/allow-once/override/timeout). |
| `/api/approvals/stats` | GET | KPIs + 14-day sparkline + by-risk breakdown for the Approvals page. |
| `/api/onboarding/status` | GET | First-run signals + sticky completion flag. |
| `/api/onboarding/complete` | POST | Mark onboarding done (called when the wizard finishes or is skipped). |
| `/api/onboarding/reset` | POST | Clear the flag so the wizard re-opens (Settings → Advanced → Open wizard). |
| `/api/installer/status` | GET | Host detection (OS, distro, docker, package managers) + per-tool availability + tier counts. |
| `/api/installer/catalog` | GET | Sec-ops tool catalog with per-backend package ids. |
| `/api/installer/preview` | POST | Resolve commands for a tier or tool list without persisting. |
| `/api/installer/request` | POST | Create a pending install request (approval-gated). |
| `/api/installer/requests` | GET | List requests, filterable by `status`. |
| `/api/installer/requests/:id/approve` | POST | Execute the install plan; each step traces exit + stdout/stderr tail + privilege classification. |
| `/api/installer/requests/:id/cancel` | POST | Cancel a pending request. |
| `/api/mcp/servers` | GET/POST/DELETE | MCP server management. |
| `/api/skills` | GET/POST/DELETE | Skill package management. |
| `/ws` | WebSocket | Real-time chat, tool output, run, trace, and artifact events. |

## 🧪 Development & Verification

PHANTOM uses Node's built-in test runner and keeps the frontend framework-free. The
test runner is a small Node script (`scripts/run-tests.js`) rather than a shell
glob so PowerShell and bash both work; it walks `server/` and `frontend/js/` for
`*.test.js` files and supports separate unit / e2e / watch modes.

```bash
# Everything (unit + E2E smoke) — what CI should run
npm test

# Unit + integration tests only (fastest, excludes server/e2e/**)
npm run test:unit

# End-to-end smoke driving processMessage → trace → synthesis
npm run test:e2e

# Watch mode for tight iteration (defaults to unit + frontend)
npm run test:watch

# Frontend build
npm run build

# Smoke test against the local server/model route
python3 tests/smoke_test.py

# Whitespace check before commit
git diff --check
```

### What the suite covers

- **Pure-function unit tests** — synthesis builder, installer catalog/detection,
  posture trending, classify, system-prompt block placement, scope/policy
  evaluator, governed-run flow, password-audit capability split.
- **HTTP integration tests** — `server/routes/api.test.js` spins up Express
  against `:memory:` SQLite and exercises every route group end-to-end.
- **LLM agent-loop tests** — scripted fake-OpenAI server validates multi-turn
  continuation, the Grok-style `finish_reason: 'stop'` + `tool_calls` tolerance,
  iteration cap (40), and stuck-state guard.
- **E2E smoke** (`server/e2e/full-run.test.js`) — drives `processMessage`
  through a real run lifecycle and validates the synthesis v1 shape that the
  Runs page consumes.
- **Frontend render tests** — `frontend/js/synthesis-card.test.js` and
  `frontend/js/pages/installer-panel.test.js` render against a minimal DOM stub
  and assert on output HTML (no jsdom dependency).

## 🔒 Security Notes

- Use PHANTOM only for systems you own or are explicitly authorized to test.
- `.env`, local databases, generated traces, and workspace artifacts are excluded from git.
- API keys and provider tokens should remain local and should never be pasted into prompts, docs, traces, or screenshots.
- Prompt/config/scope snapshots are redacted before display/storage where sensitive values may appear.
- Credential references should be labels/pointers, not raw secrets.
- Scope policy gates reduce risk but do not replace human judgment, authorization, or environment isolation.
- Run PHANTOM in a lab or controlled workstation context when using offensive security tools.

## 🤝 Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/governed-workflow`.
3. Keep changes focused and covered by `node --test` where possible.
4. Run the verification commands above.
5. Open a pull request with screenshots or replay/artifact examples for UI changes.

## 📄 License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

## ⚠️ Disclaimer

PHANTOM is designed for **authorized security testing only**. Always obtain proper authorization before testing any system. The authors and contributors are not responsible for misuse.

---

<div align="center">

**Built for transparent, governed security automation.**

</div>
