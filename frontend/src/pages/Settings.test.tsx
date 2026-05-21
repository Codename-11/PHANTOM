// Settings page — tab switching + provider pill states, behind stubbed
// fetch responses. We don't exercise the full settings round-trip here;
// settings.ts is a thin wrapper around apiFetch and the integration is
// covered by the page's existence smoke test plus the provider pill
// derivation table.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/components/ui/toast';
import SettingsPage from './Settings';
import { deriveProviderState } from '@/lib/settings';
import type { AppSettings, DiagnosticsResult } from '@/lib/types';

// SettingsPage now consumes useToast() on save, so every render needs a
// ToastProvider in the tree. The shared renderWithProviders harness does
// not include one; wrap here (page-scoped, within file ownership).
function renderSettings(route = '/react/settings') {
  return renderWithProviders(
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>,
    { route },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SETTINGS_OK: AppSettings = {
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: '••••••••wxyz',
  apiKeySet: true,
  model: 'claude-opus-4-5',
  temperature: 0.7,
  maxTokens: 4096,
  workspace: '/workspace',
};

const DIAG_OK: DiagnosticsResult = {
  overall: 'ok',
  checks: [
    { id: 'runtime', status: 'ok', detail: 'docker · root', elapsedMs: 4 },
    { id: 'db', status: 'ok', detail: 'sqlite reachable', elapsedMs: 2 },
    { id: 'provider', status: 'ok', detail: 'reachable', elapsedMs: 60 },
  ],
  elapsedMs: 12,
  generatedAt: new Date().toISOString(),
};

const PROFILES_OK = [
  { id: 'p1', name: 'Recon-only', description: 'passive recon profile', mode: 'recon', is_default: true },
];
const FRAGMENTS_OK = [
  { id: 'f1', profile_id: null, kind: 'custom', name: 'House rules', enabled: true, position: 100 },
  { id: 'f2', profile_id: null, kind: 'policy', name: 'Legacy guard', enabled: false, position: 110 },
];
const SCOPES_OK = [
  {
    id: 's1',
    name: 'Lab network',
    targets: {},
    allowed_actions: ['recon', 'network-scan'],
    blocked_actions: ['exploit'],
    action_modes: null,
    expires_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: null,
    rules_of_engagement: '',
    credential_refs: [],
    notes: '',
  },
];
const MCP_OK = [
  { id: 'm1', name: 'fs-bridge', transport: 'stdio', command: 'mcp-fs', args: null, url: null },
];
const SKILLS_OK = [{ name: 'osint', description: 'open-source recon', files: ['skill.json', 'run.py'] }];

function stubFetch(map: Record<string, unknown> = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    // Order matters — match the more specific /api/settings? branches first.
    if (url.includes('/api/diagnostics')) return jsonResponse(map.diagnostics ?? DIAG_OK);
    if (url.includes('/api/prompts/profiles')) return jsonResponse(map.profiles ?? PROFILES_OK);
    if (url.includes('/api/prompts/fragments')) return jsonResponse(map.fragments ?? FRAGMENTS_OK);
    if (url.includes('/api/scopes')) return jsonResponse(map.scopes ?? SCOPES_OK);
    if (url.includes('/api/mcp/servers')) return jsonResponse(map.mcp ?? MCP_OK);
    if (url.includes('/api/skills')) return jsonResponse(map.skills ?? SKILLS_OK);
    if (url.includes('/api/toolpacks')) return jsonResponse(map.toolpacks ?? []);
    if (url.includes('/api/settings')) return jsonResponse(map.settings ?? SETTINGS_OK);
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

describe('SettingsPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the heading + provider state pill once settings load', async () => {
    stubFetch();
    renderSettings();

    expect(screen.getByRole('heading', { level: 1, name: /Settings/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('status', { name: /Provider state/i })).toBeInTheDocument();
    });
  });

  it('renders the full tab strip with the canonical eight tabs', async () => {
    stubFetch();
    renderSettings();

    // Wait for the tabs container to mount.
    await waitFor(() => {
      expect(screen.getByTestId('settings-tabs')).toBeInTheDocument();
    });
    // Tabs render their triggers as <button role="tab">. We assert the
    // full IA matches the legacy bundle so any visual regression here
    // (e.g. a missing tab) trips this test.
    const expected = [
      'Models',
      'General',
      'Agent Behavior',
      'Prompts',
      /Security/i,
      /Tools/i,
      'Diagnostics',
      'Advanced',
    ];
    for (const name of expected) {
      expect(
        screen.getByRole('tab', { name: name as RegExp | string }),
      ).toBeInTheDocument();
    }
  });

  it('renders the provider editor for the default tab', async () => {
    stubFetch();
    renderSettings();

    // Models is the default selected tab — the provider editor sits
    // inside its content panel and should mount on first paint.
    await waitFor(() => {
      expect(screen.getByTestId('settings-provider-form')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings-provider-select')).toHaveValue('anthropic');
    expect(screen.getByTestId('settings-model')).toHaveValue('claude-opus-4-5');
  });

  it('switches to the Diagnostics tab via the radix controlled API', async () => {
    // Radix Tabs uses pointerdown internally — keyboard Enter is the
    // most reliable way to toggle in jsdom. We focus the Diagnostics tab
    // and press Enter; Radix's keydown handler picks it up.
    stubFetch();
    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Diagnostics/i })).toBeInTheDocument();
    });
    const diagnosticsTab = screen.getByRole('tab', { name: /Diagnostics/i });
    diagnosticsTab.focus();
    fireEvent.keyDown(diagnosticsTab, { key: 'Enter' });
    fireEvent.keyUp(diagnosticsTab, { key: 'Enter' });
    // Fallback to click — some test envs emit it after keyDown(Enter).
    fireEvent.click(diagnosticsTab);

    // Either path should yield an aria-selected tab.
    await waitFor(() => {
      expect(diagnosticsTab).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('surfaces the saved error banner on settings PUT failure', async () => {
    let putCalled = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/settings') && init?.method === 'PUT') {
        putCalled++;
        return jsonResponse({ error: 'provider unknown' }, 400);
      }
      if (url.includes('/api/settings')) return jsonResponse(SETTINGS_OK);
      if (url.includes('/api/diagnostics')) return jsonResponse(DIAG_OK);
      if (url.includes('/api/toolpacks')) return jsonResponse([]);
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('settings-provider-form')).toBeInTheDocument();
    });

    fireEvent.submit(screen.getByTestId('settings-provider-form'));

    await waitFor(() => {
      expect(putCalled).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/provider unknown/i);
    });
  });

  // ── Newly-filled placeholder tabs (A8.5b parity-close) ────────────────
  // Each tab switch mirrors the Diagnostics-tab pattern (focus + Enter +
  // click fallback) since Radix tabs use pointer/keyboard events in jsdom.
  async function activateTab(name: RegExp) {
    await waitFor(() => {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    });
    const tab = screen.getByRole('tab', { name });
    tab.focus();
    fireEvent.keyDown(tab, { key: 'Enter' });
    fireEvent.keyUp(tab, { key: 'Enter' });
    fireEvent.click(tab);
    await waitFor(() => {
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });
  }

  it('renders real prompt profiles + fragments on the Prompts tab', async () => {
    stubFetch();
    renderSettings();
    await activateTab(/Prompts/i);

    await waitFor(() => {
      expect(screen.getByTestId('prompts-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('prompts-profiles-list')).toHaveTextContent('Recon-only');
    const fragments = screen.getByTestId('prompts-fragments-list');
    expect(fragments).toHaveTextContent('House rules');
    expect(fragments).toHaveTextContent('Legacy guard');
  });

  it('renders configured scopes with allow/block posture on the Security tab', async () => {
    stubFetch();
    renderSettings();
    await activateTab(/Security/i);

    await waitFor(() => {
      expect(screen.getByTestId('security-panel')).toBeInTheDocument();
    });
    const list = screen.getByTestId('scopes-list');
    expect(list).toHaveTextContent('Lab network');
    expect(list).toHaveTextContent('+recon');
    expect(list).toHaveTextContent('exploit');
    // The deep link now uses a bare path, not /react/scope.
    expect(screen.getByTestId('settings-open-scope')).toHaveAttribute('href', '/scope');
  });

  it('renders toolpacks, MCP servers, and skills on the Tools tab', async () => {
    stubFetch();
    renderSettings();
    await activateTab(/Tools/i);

    await waitFor(() => {
      expect(screen.getByTestId('tools-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mcp-list')).toHaveTextContent('fs-bridge');
    expect(screen.getByTestId('skills-list')).toHaveTextContent('osint');
  });
});

describe('deriveProviderState', () => {
  it('returns missing when settings are absent', () => {
    expect(deriveProviderState(undefined, undefined)).toBe('missing');
  });

  it('returns missing when the api key is unset', () => {
    expect(
      deriveProviderState({ ...SETTINGS_OK, apiKeySet: false }, DIAG_OK),
    ).toBe('missing');
  });

  it('returns reachable when the provider check is ok', () => {
    expect(deriveProviderState(SETTINGS_OK, DIAG_OK)).toBe('reachable');
  });

  it('returns failed when the provider check is blocked', () => {
    const diag: DiagnosticsResult = {
      ...DIAG_OK,
      checks: DIAG_OK.checks.map((c) =>
        c.id === 'provider' ? { ...c, status: 'blocked' } : c,
      ),
    };
    expect(deriveProviderState(SETTINGS_OK, diag)).toBe('failed');
  });

  it('returns proxy-backed when the base URL points at the local hermes sidecar', () => {
    const proxied: AppSettings = {
      ...SETTINGS_OK,
      baseUrl: 'http://127.0.0.1:8648/v1',
    };
    expect(deriveProviderState(proxied, DIAG_OK)).toBe('proxy-backed');
  });

  it('returns configured when settings exist but diagnostics has no provider row yet', () => {
    const diag: DiagnosticsResult = { ...DIAG_OK, checks: [] };
    expect(deriveProviderState(SETTINGS_OK, diag)).toBe('configured');
  });
});
