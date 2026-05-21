// Campaigns list — empty + populated rendering, behind a stubbed fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import CampaignsPage from './Campaigns';

interface FetchInit { method?: string; body?: string; headers?: HeadersInit }
type FetchFn = (url: string, init?: FetchInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CampaignsPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the empty state when no campaigns exist', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ campaigns: [] }),
    ) as unknown as typeof fetch;

    renderWithProviders(<CampaignsPage />, { route: '/react/campaigns' });

    expect(screen.getByRole('heading', { level: 1, name: /Campaigns/i }))
      .toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('campaigns-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/No campaigns yet/i)).toBeInTheDocument();
  });

  it('renders a row per campaign with status pill + meta + objective', async () => {
    const fetchMock: FetchFn = async () =>
      jsonResponse({
        campaigns: [
          {
            id: 'c1',
            title: 'Map AdminPortal',
            objective: 'Find every admin URL exposed to the lab subnet.',
            status: 'running',
            scope_id: 'scope-a',
            prompt_profile_id: null,
            toolpack_ids: ['web-recon', 'reporting'],
            worker_backend: 'phantom-native',
            run_budget: { maxChildRuns: 5, maxAttemptsPerGoal: 2 },
            risk_budget: {},
            notification_policy: null,
            created_at: new Date(Date.now() - 60_000).toISOString(),
            started_at: null,
            ended_at: null,
          },
        ],
      });
    globalThis.fetch = vi.fn(fetchMock as unknown as typeof fetch) as unknown as typeof fetch;

    renderWithProviders(<CampaignsPage />, { route: '/react/campaigns' });

    await waitFor(() => {
      expect(screen.getByText('Map AdminPortal')).toBeInTheDocument();
    });
    // Status pill renders with the running variant.
    expect(screen.getByText('running')).toBeInTheDocument();
    // Meta line surfaces toolpacks and budget caps.
    expect(screen.getByText(/web-recon, reporting/)).toBeInTheDocument();
    expect(screen.getByText(/runs cap: 5/)).toBeInTheDocument();
    expect(screen.getByText(/attempts\/goal: 2/)).toBeInTheDocument();
    // Row link uses the bare canonical detail route.
    const link = screen.getByRole('link', { name: /Open Map AdminPortal/i });
    expect(link).toHaveAttribute('href', '/campaigns/c1');
  });

  it('truncates very long objectives with an ellipsis', async () => {
    const long = 'x'.repeat(300);
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        campaigns: [
          {
            id: 'c2',
            title: 'Long',
            objective: long,
            status: 'draft',
            scope_id: null,
            prompt_profile_id: null,
            toolpack_ids: [],
            worker_backend: 'phantom-native',
            run_budget: {},
            risk_budget: {},
            notification_policy: null,
            created_at: new Date().toISOString(),
            started_at: null,
            ended_at: null,
          },
        ],
      }),
    ) as unknown as typeof fetch;

    renderWithProviders(<CampaignsPage />, { route: '/react/campaigns' });

    await waitFor(() => {
      expect(screen.getByText('Long')).toBeInTheDocument();
    });
    // 200 chars + ellipsis, never 300.
    const xCells = screen.getAllByText(/x{50,}/);
    expect(xCells.length).toBeGreaterThan(0);
    const text = xCells[0]?.textContent ?? '';
    expect(text.length).toBeLessThanOrEqual(201);
    expect(text.endsWith('…')).toBe(true);
  });

  it('shows the failure banner on a network error', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'boom' }, 500),
    ) as unknown as typeof fetch;

    renderWithProviders(<CampaignsPage />, { route: '/react/campaigns' });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load campaigns/);
  });
});
