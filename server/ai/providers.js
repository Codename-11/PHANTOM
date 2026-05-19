/**
 * Provider registry for PHANTOM's LLM client.
 *
 * Every entry is an OpenAI-compatible endpoint. The current llm-client.js
 * uses the openai SDK with a swappable baseURL, so adding a provider here
 * is a configuration concern, not a code-path concern — the wire protocol
 * is identical (POST /chat/completions with the OpenAI request shape).
 *
 * Native non-OpenAI schemas (Anthropic Messages API, Google Gemini's
 * generativelanguage API) are flagged with `nativeSchema: true` and
 * intentionally not wired yet — adding them would require their own
 * adapter modules. Users wanting Claude / Gemini today should pick:
 *   • hermes        (if they have a Claude Pro / ChatGPT Pro / SuperGrok
 *                    subscription routed through the local Hermes proxy)
 *   • openrouter    (BYOK — OpenRouter exposes ~250 models, including
 *                    Claude / Gemini / Grok, all behind a single
 *                    OpenAI-compatible endpoint)
 *
 * Reference: Hermes 0.14.0 subscription proxy
 *   https://hermes-agent.nousresearch.com/docs/user-guide/features/subscription-proxy
 *   Local OAuth-backed proxy listening on http://127.0.0.1:8645/v1 that
 *   fronts Claude Pro / ChatGPT Pro / SuperGrok subscriptions as an
 *   OpenAI-compatible endpoint. Any bearer token works on the client
 *   side — the proxy attaches real OAuth credentials per-request.
 */

export const PROVIDERS = [
  {
    id: 'hermes',
    name: 'Hermes Proxy',
    baseUrl: 'http://127.0.0.1:8645/v1',
    description:
      'Local OAuth-backed proxy that routes Claude Pro / ChatGPT Pro / SuperGrok subscriptions through one OpenAI-compatible endpoint.',
    keyHint: 'hermes-proxy',
    keyOptional: true,
    openaiCompatible: true,
    suggestedModels: [
      'grok-4.3',
      'grok-4.20-reasoning',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'hermes-4-405b',
    ],
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/subscription-proxy',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: 'Direct OpenAI API. Requires a valid sk-… key.',
    keyHint: 'sk-…',
    keyOptional: false,
    openaiCompatible: true,
    suggestedModels: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-4o'],
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    description: 'xAI Grok API. OpenAI-compatible at /v1/chat/completions.',
    keyHint: 'xai-…',
    keyOptional: false,
    openaiCompatible: true,
    suggestedModels: ['grok-4.3', 'grok-4.20-reasoning', 'grok-code-fast-1'],
    docsUrl: 'https://docs.x.ai/api',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: 'Multi-vendor router. Single key, ~250 models including Claude, Gemini, Grok, Llama, Mistral.',
    keyHint: 'sk-or-v1-…',
    keyOptional: false,
    openaiCompatible: true,
    suggestedModels: [
      'anthropic/claude-opus-4-7',
      'anthropic/claude-sonnet-4-6',
      'google/gemini-2.5-pro',
      'x-ai/grok-4.3',
      'openai/gpt-5.4',
      'meta-llama/llama-4.1-405b',
    ],
    docsUrl: 'https://openrouter.ai/docs',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    description: 'High-speed inference for open-weight models on LPU hardware.',
    keyHint: 'gsk_…',
    keyOptional: false,
    openaiCompatible: true,
    suggestedModels: [
      'llama-4.1-70b-versatile',
      'llama-4.1-8b-instant',
      'mixtral-8x22b',
      'qwen-3-235b',
    ],
    docsUrl: 'https://console.groq.com/docs',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    description: 'DeepSeek V3 / R1 reasoning. OpenAI-compatible; reasoning tokens streamed in `reasoning_content`.',
    keyHint: 'sk-…',
    keyOptional: false,
    openaiCompatible: true,
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    docsUrl: 'https://api-docs.deepseek.com',
  },
  {
    id: 'together',
    name: 'Together.ai',
    baseUrl: 'https://api.together.xyz/v1',
    description: 'Together.ai hosted open-weight models.',
    keyHint: 'tgp_…',
    keyOptional: false,
    openaiCompatible: true,
    suggestedModels: [
      'meta-llama/Llama-4.1-405B-Instruct',
      'Qwen/Qwen3-235B',
      'deepseek-ai/DeepSeek-V3',
    ],
    docsUrl: 'https://docs.together.ai',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    description: 'Local Ollama daemon in OpenAI-compatible mode. No key needed.',
    keyHint: 'ollama',
    keyOptional: true,
    openaiCompatible: true,
    suggestedModels: ['llama-4.1:8b', 'qwen-3:14b', 'deepseek-r1:14b'],
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    baseUrl: 'http://127.0.0.1:1234/v1',
    description: 'Local LM Studio server. No key needed.',
    keyHint: 'lm-studio',
    keyOptional: true,
    openaiCompatible: true,
    suggestedModels: [],
    docsUrl: 'https://lmstudio.ai/docs/local-server',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (native — coming soon)',
    baseUrl: 'https://api.anthropic.com/v1',
    description:
      'Anthropic Messages API uses its own schema (system block, content blocks, tool_use blocks). Not yet wired — route through Hermes or OpenRouter for now.',
    keyHint: 'sk-ant-…',
    keyOptional: false,
    openaiCompatible: false,
    nativeSchema: true,
    suggestedModels: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    docsUrl: 'https://docs.claude.com/en/api/messages',
    unavailable: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini (native — coming soon)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    description:
      'Google Generative Language API uses its own schema (contents, parts). Not yet wired — route through OpenRouter for now.',
    keyHint: 'AIza…',
    keyOptional: false,
    openaiCompatible: false,
    nativeSchema: true,
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    docsUrl: 'https://ai.google.dev/api/rest',
    unavailable: true,
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    baseUrl: '',
    description: 'Any OpenAI-compatible server. Enter the base URL and bearer token manually.',
    keyHint: 'sk-…',
    keyOptional: false,
    openaiCompatible: true,
    suggestedModels: [],
    docsUrl: '',
  },
];

const PROVIDER_INDEX = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

/** Default provider id. Matches the existing UI default and the boot panel. */
export const DEFAULT_PROVIDER_ID = 'hermes';

/** Get a provider by id. Falls back to the default if unknown. */
export function getProvider(id) {
  return PROVIDER_INDEX[id] || PROVIDER_INDEX[DEFAULT_PROVIDER_ID];
}

/** Resolve provider id → base URL. Empty string for 'custom'. */
export function baseUrlFor(id) {
  return getProvider(id).baseUrl || '';
}

/** Public-safe view of the registry for the settings UI (no implementation flags). */
export function listProvidersPublic() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    description: p.description,
    keyHint: p.keyHint,
    keyOptional: !!p.keyOptional,
    openaiCompatible: !!p.openaiCompatible,
    nativeSchema: !!p.nativeSchema,
    suggestedModels: p.suggestedModels || [],
    docsUrl: p.docsUrl || '',
    unavailable: !!p.unavailable,
  }));
}
