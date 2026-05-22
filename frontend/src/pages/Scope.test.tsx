// Scope list — empty + populated rendering, behind a stubbed fetch.
// Mirrors the Campaigns list test pattern so the assertion shape stays
// uniform across the migrated surfaces.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { renderWithProviders } from '@/test/test-utils';
import ScopesPage, { ScopeDetailRoute } from './Scope';
import type { ScopeRecord } from '@/lib/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeScope(overrides: Partial<ScopeRecord> = {}): ScopeRecord {
  return {
    id: 's1',
    name: 'LAB-INTERNAL',
    targets: { hosts: ['10.0.0.5'], domains: ['lab.test'], cidrs: [], urls: [] },
    allowed_actions: ['recon', 'network-scan'],
    blocked_actions: ['exploit', 'destructive'],
    action_modes: null,
    active_hours: null,
    blackout_windows: null,
    rate_caps: null,
    rules_of_engagement: '',
    credential_refs: [],
    notes: '',
    expires_at: null,
    created_at: new Date().toISOString(),
    updated_at: null,
    archived_at: null,
    ...overrides,
  };
}

describe('ScopesPage', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the empty state when no scopes exist', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    renderWithProviders(<ScopesPage />, { route: '/scope' });

    expect(screen.getByRole('heading', { level: 1, name: /Scope/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('scopes-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/No scopes yet/i)).toBeInTheDocument();
  });

  it('renders a row per scope with the active pill + target count', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        makeScope(),
        makeScope({ id: 's2', name: 'BUG-BOUNTY', targets: { urls: ['https://example.test'] } }),
      ]),
    ) as unknown as typeof fetch;

    renderWithProviders(<ScopesPage />, { route: '/scope' });

    await waitFor(() => {
      expect(screen.getByTestId('scopes-list')).toBeInTheDocument();
    });
    expect(screen.getByText('LAB-INTERNAL')).toBeInTheDocument();
    expect(screen.getByText('BUG-BOUNTY')).toBeInTheDocument();
    // active pill renders for each row (both unexpired, unarchived).
    expect(screen.getAllByText('active').length).toBeGreaterThanOrEqual(2);
    // target counts surface in the meta line.
    expect(screen.getByText(/targets: 2/i)).toBeInTheDocument();
    expect(screen.getByText(/targets: 1/i)).toBeInTheDocument();
    // Rows link to the bare /scope/:id path (no legacy /react prefix).
    expect(screen.getByLabelText('Open LAB-INTERNAL')).toHaveAttribute('href', '/scope/s1');
  });

  it('renders the expired pill when expires_at is in the past', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([makeScope({ expires_at: past })]),
    ) as unknown as typeof fetch;

    renderWithProviders(<ScopesPage />, { route: '/scope' });
    await waitFor(() => {
      expect(screen.getByText('expired')).toBeInTheDocument();
    });
  });

  it('renders the archived pill when archived_at is set', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([makeScope({ archived_at: new Date().toISOString() })]),
    ) as unknown as typeof fetch;

    renderWithProviders(<ScopesPage />, { route: '/scope' });
    await waitFor(() => {
      expect(screen.getByText('archived')).toBeInTheDocument();
    });
  });

  it('renders the detail metadata as a Kv grid with target chips + class badges', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        makeScope({
          rules_of_engagement: 'No traffic after 22:00.',
          notes: 'handle with care',
        }),
      ),
    ) as unknown as typeof fetch;

    renderWithProviders(
      <Routes>
        <Route path="/scope/:id" element={<ScopeDetailRoute />} />
      </Routes>,
      { route: '/scope/s1' },
    );

    await waitFor(() => {
      expect(screen.getByTestId('scope-detail-kv')).toBeInTheDocument();
    });
    // Detail renders inline as a persistent `.drawer` panel (no modal sheet).
    expect(screen.getByTestId('scope-detail-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Close detail')).toBeInTheDocument();
    const kv = screen.getByTestId('scope-detail-kv');
    // Kv keys present.
    expect(within(kv).getByText('Allowed')).toBeInTheDocument();
    expect(within(kv).getByText('Blocked')).toBeInTheDocument();
    expect(within(kv).getByText('RoE')).toBeInTheDocument();
    // Targets render as kit target chips.
    expect(kv.querySelector('.chip.target[data-value]')).toBeTruthy();
    expect(within(kv).getByText('10.0.0.5')).toBeInTheDocument();
    // Allowed/blocked classes render as `.badge` chips.
    expect(kv.querySelector('.badge.ok')).toBeTruthy();
    expect(kv.querySelector('.badge.policy')).toBeTruthy();
    expect(within(kv).getByText('No traffic after 22:00.')).toBeInTheDocument();
  });

  it('keeps the list visible beside the inline detail (split-pane)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // The :id detail fetch resolves a single scope; the list fetch an array.
      if (/\/scopes\/s1\b/.test(url)) {
        return jsonResponse(makeScope());
      }
      return jsonResponse([makeScope(), makeScope({ id: 's2', name: 'BUG-BOUNTY' })]);
    }) as unknown as typeof fetch;

    renderWithProviders(
      <Routes>
        <Route path="/scope" element={<ScopesPage />}>
          <Route path=":id" element={<ScopeDetailRoute />} />
        </Route>
      </Routes>,
      { route: '/scope/s1' },
    );

    // Inline detail panel and the master list are both mounted at once —
    // SplitPane keeps the list beside the detail column (no modal overlay).
    await waitFor(() => {
      expect(screen.getByTestId('scope-detail-panel')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('scopes-list')).toBeInTheDocument();
    });
    expect(screen.getByText('BUG-BOUNTY')).toBeInTheDocument();
  });

  it('shows the failure banner on a network error', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'boom' }, 500),
    ) as unknown as typeof fetch;

    renderWithProviders(<ScopesPage />, { route: '/scope' });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load scopes/);
  });
});
