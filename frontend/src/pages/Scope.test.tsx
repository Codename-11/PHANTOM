// Scope list — empty + populated rendering, behind a stubbed fetch.
// Mirrors the Campaigns list test pattern so the assertion shape stays
// uniform across the migrated surfaces.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import ScopesPage from './Scope';
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
