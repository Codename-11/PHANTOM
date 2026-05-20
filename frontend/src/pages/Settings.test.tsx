// Settings page — tab switching + provider pill states, behind stubbed
// fetch responses. We don't exercise the full settings round-trip here;
// settings.ts is a thin wrapper around apiFetch and the integration is
// covered by the page's existence smoke test plus the provider pill
// derivation table.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import SettingsPage from './Settings';
import { deriveProviderState } from '@/lib/settings';
import type { AppSettings, DiagnosticsResult } from '@/lib/types';

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

function stubFetch(map: Record<string, unknown> = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/settings')) return jsonResponse(map.settings ?? SETTINGS_OK);
    if (url.includes('/api/diagnostics')) return jsonResponse(map.diagnostics ?? DIAG_OK);
    if (url.includes('/api/toolpacks')) return jsonResponse(map.toolpacks ?? []);
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
    renderWithProviders(<SettingsPage />, { route: '/react/settings' });

    expect(screen.getByRole('heading', { level: 1, name: /Settings/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('status', { name: /Provider state/i })).toBeInTheDocument();
    });
  });

  it('renders the full tab strip with the canonical eight tabs', async () => {
    stubFetch();
    renderWithProviders(<SettingsPage />, { route: '/react/settings' });

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
    renderWithProviders(<SettingsPage />, { route: '/react/settings' });

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
    renderWithProviders(<SettingsPage />, { route: '/react/settings' });

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

    renderWithProviders(<SettingsPage />, { route: '/react/settings' });
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
