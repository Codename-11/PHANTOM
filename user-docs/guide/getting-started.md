# Getting started

PHANTOM is local-first — no managed service, no cloud database, no telemetry. Production deploys are Docker-on-Linux; Windows and macOS are dev environments.

This page walks both paths. Pick the one that matches where you'll actually run PHANTOM.

## Production: Docker on Linux (primary)

You'll have a running container serving the SPA, the API, and the in-app docs at `http://localhost:1337` after these steps.

### Prerequisites

- **Docker** 24 or newer with the `docker compose` v2 plugin
  - Legacy `docker-compose` (v1) is not supported — the smoke target and build-variants script both call `docker compose` (space, not hyphen)
- An **OpenAI-compatible API endpoint** — any of:
  - OpenAI, OpenRouter, xAI, DeepSeek, Together, Groq
  - Local: Ollama, LM Studio, llama.cpp's OpenAI server, vLLM
  - The Hermes proxy (`hermes-relay`) that fronts Pro subscriptions as one endpoint

### Clone, configure, and bring up the stack

```bash
git clone https://github.com/Codename-11/PHANTOM.git
cd PHANTOM
cp .env.example .env
# edit .env — set API_PROVIDER, API_KEY, MODEL_ID
docker compose up
```

You'll see Docker build `phantom:base` (debian-slim + Node 20 + Python + Go + the base recon toolpack), then the Express server starts on port 1337. Open <http://localhost:1337>.

::: tip State lives on named volumes
SQLite (with WAL/SHM siblings) lives on `phantom-db`, mounted at `/app/data`. Workspace artifacts live on `phantom-workspace`. `docker compose down` stops the container but keeps state; `docker compose down -v` wipes both volumes.
:::

### Image variants

`phantom:base` ships the recon/OSINT minimum. Build the other variants from the same Dockerfile via the build-variants script:

```bash
node scripts/build-variants.js              # build all five
node scripts/build-variants.js --only blue  # build one
node scripts/build-variants.js --dry-run    # print docker commands only
```

| Tag                | Adds on top of `base`                       |
| ------------------ | ------------------------------------------- |
| `phantom:base`     | (recon/OSINT minimum)                       |
| `phantom:offensive`| nikto, whatweb, gobuster, hydra             |
| `phantom:blue`     | tshark, tcpdump, chkrootkit, rkhunter       |
| `phantom:full`     | offensive + blue                            |
| `phantom:full-msf` | full + Metasploit Framework (opt-in layer)  |

To run a variant instead of `phantom:base`, edit `docker-compose.yml` and point `image:` at the variant tag.

### Smoke the container before relying on it

```bash
npm run smoke:docker
```

The script runs `docker compose build → up -d`, polls `/api/installer/status` until it returns 200, hits `/api/onboarding/status`, `/api/runs`, and `/api/toolpacks`, then tears the stack down. You'll get a non-zero exit and a banner pointing at the failing stage if anything drifts.

## Dev environment (Windows / macOS)

For HMR, native sqlite, and native file watchers, run PHANTOM directly. The multi-backend installer (winget/choco/scoop/apt/dnf/pacman/brew/wsl-apt) detects what's available on your host and surfaces it in Settings → Tools.

### Prerequisites

- **Node.js** 18 or newer
- **npm** (ships with Node)
- An **OpenAI-compatible API endpoint** (same list as above)
- (Optional) **Python 3.10+** for the smoke tests bundled under `tests/`

### Install and run

```bash
git clone https://github.com/Codename-11/PHANTOM.git
cd PHANTOM
npm install
cp .env.example .env
npm run dev
```

This starts Express on `http://localhost:1337` and Vite on `http://localhost:5173`. Open the Vite URL.

For a production-style server without the Vite dev process:

```bash
npm run build
npm start
```

For docs hot-reload while authoring:

```bash
npm run dev:docs   # VitePress dev server on port 5174
```

## Configure your provider

PHANTOM reads provider configuration from `.env`. The same file works for both Docker compose (passed through to the container) and the dev environment.

```env
# Pick a provider id from server/ai/providers.js — default is `hermes`.
# Other options: openai · xai · openrouter · groq · deepseek · together
# · ollama · lmstudio · custom
API_PROVIDER=openai

# Auto-derived from the provider id; override only for `custom` or a
# self-hosted endpoint that doesn't match the registry default.
# API_BASE_URL=http://127.0.0.1:11434/v1

# Your bearer token. Leave blank for local Ollama / LM Studio.
API_KEY=sk-…

# Pick a model your provider serves.
MODEL_ID=gpt-4o

TEMPERATURE=0.7
MAX_TOKENS=4096
```

::: tip You can also configure in the UI
Provider, base URL, key, and model are all editable from Settings → Models after the server boots — `.env` is just the seed. Settings persists changes to the local SQLite database (which lives on the `phantom-db` volume in Docker, or `phantom.db` in the repo root in dev).
:::

## First boot

On a fresh install, the [onboarding wizard](/guide/onboarding-wizard) opens automatically about a second after the page paints. It walks you through:

1. What PHANTOM is.
2. Provider + API key + test connection.
3. Your first scope (using a Rules-of-Engagement template).
4. A preview of the synthesis card you'll see after your first run.

Skip it any time — you can re-open it from **Settings → Advanced → Open wizard**.

## After setup

Head to your first run. The [Your first run](/guide/first-run) page walks through driving a recon engagement and reading the synthesis card.

## Tests

PHANTOM ships with a Node-based test suite split into unit and end-to-end modes:

```bash
# Everything (what CI runs)
npm test

# Unit + integration tests only (fastest)
npm run test:unit

# End-to-end smoke driving processMessage → trace → synthesis
npm run test:e2e

# Watch mode for tight iteration
npm run test:watch
```

The runner walks `server/` and `frontend/js/` for `*.test.js` so it works on both PowerShell and bash without shell-glob portability issues.
