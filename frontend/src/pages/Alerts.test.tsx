// Alerts page — list renders, filter chips narrow the result set, and
// the triage rail submits the right status. We don't exercise the full
// dismiss dialog flow here (that's covered by TriageRail.test.tsx) —
// the page-level test just confirms the rail wires up to PATCH the
// right endpoint.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { makeQueryClient } from '@/test/test-utils';
import AlertsPage, { AlertDetailRoute } from './Alerts';
import type { FindingRecord } from '@/lib/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const findings: FindingRecord[] = [
  {
    id: 'f-crit',
    title: 'SSRF on /api/proxy',
    description: 'unbounded URL proxy lets request forging',
    severity: 'critical',
    status: 'open',
    assetId: 'asset-1',
    runId: 'run-1',
    recommendation: 'Validate target URL against an allowlist.',
    evidence: null,
    metadata: { target: 'app.lab' },
    first_seen_at: '2026-05-19T12:00:00Z',
    last_seen_at: '2026-05-20T12:00:00Z',
    fixed_at: null,
    triage_status: 'new',
  },
  {
    id: 'f-low',
    title: 'TLS allows TLS1.1',
    description: 'older TLS version still negotiable',
    severity: 'low',
    status: 'open',
    assetId: 'asset-2',
    runId: 'run-2',
    recommendation: null,
    evidence: null,
    metadata: { target: 'edge.lab' },
    first_seen_at: '2026-05-18T12:00:00Z',
    last_seen_at: '2026-05-19T12:00:00Z',
    fixed_at: null,
    triage_status: 'new',
  },
];

function stubFetch(map: Record<string, unknown> = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('http')) {
      // jsdom defaults to localhost — strip the origin for matching.
    }
    if (url.includes('/api/findings/') && url.includes('/triage')) {
      (globalThis.fetch as unknown as { _last?: unknown })._last = {
        url, method: init?.method, body: init?.body ?? null,
      };
      return jsonResponse(map.triage ?? { id: 'f-low', triage_status: 'acknowledged' });
    }
    if (url.includes('/api/findings')) {
      return jsonResponse(map.findings ?? findings);
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

function renderRoute(initial: string, qc: QueryClient = makeQueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/react/alerts" element={<AlertsPage />}>
            <Route path=":id" element={<AlertDetailRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AlertsPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the findings list with severity badges', async () => {
    stubFetch();
    renderRoute('/react/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
    });
    expect(screen.getByText(/SSRF on \/api\/proxy/)).toBeInTheDocument();
    expect(screen.getByText(/TLS allows TLS1\.1/)).toBeInTheDocument();
    const badges = screen.getAllByTestId('severity-badge');
    // 2 in the rows.
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('filter chip restricts the rows to the selected severity', async () => {
    stubFetch();
    renderRoute('/react/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
    });
    // Click the "critical" chip — the low row should disappear.
    fireEvent.click(screen.getByTestId('alerts-chip-critical'));
    await waitFor(() => {
      expect(screen.queryByText(/TLS allows TLS1\.1/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/SSRF on \/api\/proxy/)).toBeInTheDocument();
  });

  it('renders the triage rail in the detail Sheet and submits Ack', async () => {
    stubFetch();
    renderRoute('/react/alerts/f-low');
    // Both the AlertsPage list and the inner AlertDetailRoute depend on
    // /api/findings; wait until the detail Sheet finishes loading.
    const rail = await screen.findByTestId('triage-rail', {}, { timeout: 3000 });
    expect(rail).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Ack$/ }));
    await waitFor(() => {
      const last = (globalThis.fetch as unknown as {
        _last?: { url: string; method?: string; body?: string };
      })._last;
      expect(last?.method).toBe('PATCH');
      expect(last?.url).toMatch(/\/api\/findings\/f-low\/triage$/);
      const parsed = JSON.parse(String(last?.body ?? '{}'));
      expect(parsed.triageStatus).toBe('acknowledged');
    });
  });

  it('renders the empty state when no findings match the filter', async () => {
    stubFetch({ findings: [] });
    renderRoute('/react/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-empty')).toBeInTheDocument();
    });
  });
});
