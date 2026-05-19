# Configuration

PHANTOM reads from two places: the `.env` file (provider defaults + port) and the SQLite `settings` table (runtime overrides + feature flags).

## Source of truth

Boot order:

1. `server/index.js` calls `initDB()` — creates tables if missing, applies additive column migrations.
2. `loadPersistedSettings(getSetting)` reads the `settings` table.
3. Persisted settings **override** the `.env` defaults (for fields that exist in both).
4. `loadPersistedSettings` also reconciles `provider ↔ baseUrl` — if you switched providers in Settings but the persisted `baseUrl` still points at the old provider's URL, the canonical URL from the provider registry wins.

The practical implication: edit `.env` for first-run defaults, edit Settings for everything after.

## .env reference

```env
# Server port the Express API listens on. PHANTOM_API_PORT is preferred;
# PORT is honored as a fallback. The Vite dev proxy targets this.
PHANTOM_API_PORT=1337

# Pick a provider id from server/ai/providers.js.
#   hermes · openai · xai · openrouter · groq · deepseek · together
#   · ollama · lmstudio · custom
API_PROVIDER=hermes

# Auto-derived from the provider above. Override only for `custom` or a
# self-hosted endpoint that doesn't match the registry default.
# API_BASE_URL=http://127.0.0.1:8645/v1

# Bearer token. Leave blank for local Ollama / LM Studio.
API_KEY=

# Model id your provider serves. For Hermes, route by model slug —
# grok-4.3 routes to xAI OAuth, gpt-5.4 routes to OpenAI OAuth.
MODEL_ID=grok-4.3

TEMPERATURE=0.7
MAX_TOKENS=4096
```

The shipped `.env.example` covers the same fields with a default for the Hermes proxy. First boot copies it to `.env` if `.env` doesn't exist.

::: tip Placeholder keys are filtered
The config layer treats literal placeholder values (`sk-your-api-key-here`, `your-api-key-here`, `sk-placeholder`, anything matching `/^sk-your-/`) as "no key set." Prevents the example file from accidentally leaking through to `Authorization` headers as a 401.
:::

## Settings table

Schema: `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`. All values are strings; PHANTOM parses them on read.

### Known keys

| Key | Type | Set via | Purpose |
|---|---|---|---|
| `api_provider` | string | Settings → Models | Provider id (overrides `API_PROVIDER`). |
| `api_base_url` | string | Settings → Models | Provider base URL (overrides `API_BASE_URL`). |
| `api_key` | string | Settings → Models | Provider bearer token (overrides `API_KEY`). |
| `api_model` | string | Settings → Models | Model id (overrides `MODEL_ID`). |
| `api_temperature` | float-as-string | Settings → Models | Override `TEMPERATURE`. |
| `api_max_tokens` | int-as-string | Settings → Models | Override `MAX_TOKENS`. |
| `workspace` | path | Settings → General | Where run artifacts and traces land. Default `<repo>/workspace`. |
| `sudo_password` | string | Settings → General → Validate sudo / `POST /api/sudo/validate` | Cached for the installer's Linux mitigation. Never returned by `GET /api/settings`. |
| `synthesis_llm_enabled` | `'0'` / `'1'` | Settings → Advanced → toggle | Whether the end-of-run synthesis card asks the model to rewrite highlights/nextSteps. Off by default. |
| `onboarding_completed` | `'0'` / `'1'` | Wizard finish / `POST /api/onboarding/{complete,reset}` | Sticky flag controlling auto-open of the first-run wizard. |

You can inspect the table directly with any SQLite tool:

```bash
sqlite3 phantom.db "SELECT * FROM settings;"
```

## Provider registry

`server/ai/providers.js` defines the known providers and their default base URLs / suggested models. Adding a new provider is a single object literal:

```js
{
  id: 'mistral',
  name: 'Mistral AI',
  baseUrl: 'https://api.mistral.ai/v1',
  suggestedModels: ['mistral-large-latest', 'mistral-medium'],
  openaiCompatible: true,
  keyOptional: false,
}
```

The Settings → Models dropdown is populated from `getActiveProviders()`. The `custom` provider is special — it requires the user to type their own base URL.

## Workspace

`config.workspace` is where:

- Per-run artifacts land under `workspace/runs/<run-id>/artifacts/`
- Trace exports land under `workspace/runs/<run-id>/trace.jsonl`
- Skill packs land under `workspace/skills/`
- Evidence bundles land under `workspace/runs/<run-id>/`

PHANTOM auto-creates the workspace directory on boot if it doesn't exist. The default is `<repo>/workspace` but Settings → General lets you override.

::: warning Workspace contents are evidence
Don't delete `workspace/` casually. Run artifacts, trace exports, and evidence bundles all live there. Snapshot the directory if you're rotating engagements.
:::

## Toolpacks

Toolpack metadata lives in `server/toolpacks/toolpack-registry.js`. There's no separate config file for toolpacks — they're hard-coded JavaScript objects so they're version-controlled with the code.

To add a custom toolpack, edit the registry and rebuild.

## Installer catalog

The sec-ops installer catalog lives in `server/tools/installer-catalog.js`. Same pattern as toolpacks — JS objects, version-controlled. To extend with your own tool, add an entry with per-backend package ids and a `tier`.

## What's NOT configurable

By design:

- `MAX_AGENT_ITERATIONS = 40` (in `server/ai/llm-client.js`) — see the [agent loop](/architecture/agent-loop) page for why.
- `APPROVAL_TIMEOUT_MS = 5 * 60 * 1000` (in `server/index.js`) — 5-minute hard ceiling on operator approval cards.
- The synthesis posture weights (40/40/20) — embedded in `server/runs/synthesis.js`.

If you have a real use case for changing any of these, open an issue. We'd want to make them configurable per scope / per workflow rather than globally.

## Database location

The SQLite database lives at `<repo>/phantom.db` (plus `-wal` and `-shm` companions when WAL mode is active). There's no separate "drop tables" command — to start fresh:

```bash
rm phantom.db phantom.db-wal phantom.db-shm
```

You'll lose all conversations, runs, scopes, settings, and install requests. Recommended only on a brand-new install or after exporting whatever you wanted to keep.
