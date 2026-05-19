import dotenv from 'dotenv';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PROVIDER_ID, baseUrlFor, getProvider } from './ai/providers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load .env if it exists, otherwise copy from example
const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) {
  const examplePath = join(ROOT, '.env.example');
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
  }
}
dotenv.config({ path: envPath });

// PHANTOM_API_PORT is preferred; PORT is honored as a fallback for direct
// `node server/index.js` workflows. The preferred var is namespaced because
// tools that manage dev servers (Vite, Claude Preview MCP, some IDE plugins)
// inject PORT into the child env, which would otherwise force us onto their
// chosen port and collide with Vite.
//
// `provider` defaults to the Hermes proxy (OAuth-backed subscriptions routed
// through a local OpenAI-compatible endpoint). API_BASE_URL is honored if
// explicitly set; otherwise it's derived from the provider id so changing
// the dropdown in Settings automatically retargets requests.
//
// `.env.example` historically shipped with `API_KEY=sk-your-api-key-here`,
// which copies into a fresh `.env` on first boot and then sails through to
// real providers as a 401. `isPlaceholderKey` filters those literal
// placeholder values so they don't leak into outbound Authorization
// headers — treat them as "no key set."
const PLACEHOLDER_KEYS = new Set(['', 'sk-your-api-key-here', 'sk-placeholder', 'your-api-key-here']);
function isPlaceholderKey(key) {
  if (!key) return true;
  if (PLACEHOLDER_KEYS.has(key)) return true;
  // Match anything that looks like a template string the user forgot to fill.
  return /^sk-your-/.test(key) || /your[-_ ]api[-_ ]key/i.test(key);
}

const initialProviderId = process.env.API_PROVIDER || DEFAULT_PROVIDER_ID;
const envKey = process.env.API_KEY || '';
const config = {
  port: parseInt(process.env.PHANTOM_API_PORT || process.env.PORT || '1337', 10),
  api: {
    provider: initialProviderId,
    baseUrl: process.env.API_BASE_URL || baseUrlFor(initialProviderId),
    apiKey: isPlaceholderKey(envKey) ? '' : envKey,
    model: process.env.MODEL_ID || 'grok-4.3',
    temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.MAX_TOKENS || '4096', 10),
  },
  workspace: join(ROOT, 'workspace'),
  db: {
    path: join(ROOT, 'phantom.db'),
  },
  root: ROOT,
};

/**
 * Update config at runtime (called from settings API).
 * When `provider` is set without an accompanying `baseUrl`, the base URL
 * is auto-derived from the provider registry so the dropdown alone is
 * enough to retarget requests.
 */
export function updateConfig(updates) {
  if (updates.provider !== undefined) {
    config.api.provider = updates.provider;
    // If the caller didn't override the URL, pull it from the registry.
    if (updates.baseUrl === undefined) {
      const provider = getProvider(updates.provider);
      if (provider.baseUrl) config.api.baseUrl = provider.baseUrl;
    }
  }
  if (updates.baseUrl !== undefined) config.api.baseUrl = updates.baseUrl;
  if (updates.apiKey !== undefined) config.api.apiKey = updates.apiKey;
  if (updates.model !== undefined) config.api.model = updates.model;
  if (updates.temperature !== undefined) config.api.temperature = parseFloat(updates.temperature);
  if (updates.maxTokens !== undefined) config.api.maxTokens = parseInt(updates.maxTokens, 10);
  if (updates.workspace !== undefined) config.workspace = updates.workspace;
}

/**
 * Load persisted settings from DB into config (called after DB init)
 *
 * Includes a small bootstrap migration for installs that pre-date the
 * provider registry: if `api_provider` is null in the DB AND the
 * persisted base URL matches the old default (`api.openai.com/v1`) with
 * a placeholder key, promote to the canonical Hermes proxy defaults so
 * the boot panel + /api/models point somewhere reachable instead of
 * 401-ing against OpenAI with `sk-your-api-key-here`.
 */
export function loadPersistedSettings(getSetting) {
  const provider = getSetting('api_provider', null);
  const baseUrl = getSetting('api_base_url', null);
  const apiKey = getSetting('api_key', null);
  const model = getSetting('api_model', null);
  const temperature = getSetting('api_temperature', null);
  const maxTokens = getSetting('api_max_tokens', null);
  const workspace = getSetting('workspace', null);

  if (provider) config.api.provider = provider;
  if (baseUrl) config.api.baseUrl = baseUrl;
  if (apiKey && !isPlaceholderKey(apiKey)) config.api.apiKey = apiKey;
  if (model) config.api.model = model;
  if (temperature) config.api.temperature = parseFloat(temperature);
  if (maxTokens) config.api.maxTokens = parseInt(maxTokens, 10);
  if (workspace) config.workspace = workspace;

  // Reconcile provider ↔ baseUrl on boot.
  //
  // The provider registry is the source of truth for the base URL of any
  // non-`custom` provider. When the persisted baseUrl matches a *different*
  // registry entry's URL, treat it as legacy data and snap to the current
  // provider's canonical URL. This handles two upgrade paths cleanly:
  //   1. Fresh install with old `.env` default (api.openai.com/v1) + new
  //      Hermes provider id → boot lands on Hermes endpoint.
  //   2. User flipped the dropdown but the DB row for api_base_url still
  //      holds the stale URL from before the click.
  //
  // The `custom` provider is exempt — its whole point is that the user
  // entered the URL by hand.
  const resolvedProvider = config.api.provider;
  if (resolvedProvider && resolvedProvider !== 'custom') {
    const canonical = baseUrlFor(resolvedProvider);
    const knownUrls = new Set([
      'https://api.openai.com/v1',
      'http://127.0.0.1:8645/v1',
      'http://127.0.0.1:8648/v1', // stale Hermes port from pre-0.14 docs
      'https://api.x.ai/v1',
      'https://openrouter.ai/api/v1',
    ]);
    const trimmed = (config.api.baseUrl || '').replace(/\/+$/, '');
    if (canonical && trimmed !== canonical && knownUrls.has(trimmed)) {
      config.api.baseUrl = canonical;
    }
    // First-run bootstrap: if no baseUrl persisted, take the canonical one.
    if (canonical && !baseUrl) {
      config.api.baseUrl = canonical;
    }
  }

  // Ensure workspace directory exists
  try {
    if (!existsSync(config.workspace)) {
      mkdirSync(config.workspace, { recursive: true });
    }
  } catch {}

  // workspace/model/api-key are now surfaced by the boot panel in server/index.js
  // so they appear once, alongside the URL block, instead of as three loose
  // emoji-prefixed lines printed before the rest of startup completes.
}

export default config;
