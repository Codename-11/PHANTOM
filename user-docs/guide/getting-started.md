# Getting started

PHANTOM runs locally on your workstation — no managed service, no cloud database, no telemetry. You'll need Node, npm, an OpenAI-compatible model endpoint, and ~5 minutes.

## Prerequisites

- **Node.js** 18 or newer
- **npm** (ships with Node)
- An **OpenAI-compatible API endpoint** — any of:
  - OpenAI, OpenRouter, xAI, DeepSeek, Together, Groq
  - Local: Ollama, LM Studio, llama.cpp's OpenAI server, vLLM
  - The Hermes proxy (`hermes-relay`) that fronts Pro subscriptions as one endpoint
- (Optional) **Python 3.10+** for the smoke tests bundled under `tests/`

PHANTOM is platform-agnostic on the developer side — it runs on Linux, macOS, and Windows (PowerShell or WSL). Some sec-ops tools the agent calls are Linux-native; the [installer](/features/sec-ops-installer) detects what's available on your host.

## Install

```bash
git clone https://github.com/Codename-11/PHANTOM.git
cd PHANTOM
npm install
```

## Configure

PHANTOM reads its provider configuration from `.env`. A first run copies `.env.example` to `.env` automatically; you can also do it by hand:

```bash
cp .env.example .env
```

Edit `.env` with your provider:

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
Provider, base URL, key, and model are all editable from Settings → Models after the server boots — `.env` is just the seed. Settings persists changes to the local SQLite database.
:::

## Run the dev server

```bash
npm run dev
```

This starts Express on `http://localhost:1337` and Vite on `http://localhost:5173`. Open the Vite URL.

For a production-style server without the Vite dev process:

```bash
npm run build
npm start
```

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
