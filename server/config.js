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
const initialProviderId = process.env.API_PROVIDER || DEFAULT_PROVIDER_ID;
const config = {
  port: parseInt(process.env.PHANTOM_API_PORT || process.env.PORT || '1337', 10),
  api: {
    provider: initialProviderId,
    baseUrl: process.env.API_BASE_URL || baseUrlFor(initialProviderId),
    apiKey: process.env.API_KEY || '',
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
  if (apiKey) config.api.apiKey = apiKey;
  if (model) config.api.model = model;
  if (temperature) config.api.temperature = parseFloat(temperature);
  if (maxTokens) config.api.maxTokens = parseInt(maxTokens, 10);
  if (workspace) config.workspace = workspace;

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
