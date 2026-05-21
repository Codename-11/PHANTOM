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
import { ToastProvider } from '@/components/ui/toast';
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
    if (url.includes('/api/assets/')) {
      return jsonResponse(
        map.asset ?? { id: 'asset-1', name: 'app-lab-01', type: 'host', address: '10.0.0.5' },
      );
    }
    if (url.includes('/api/findings/') && url.includes('/history')) {
      return jsonResponse(
        map.history ?? {
          findingId: 'f-crit',
          runId: 'run-1',
          traceEventId: 'evt-2',
          scopeId: 'scope-1',
          severity: 'critical',
          triageStatus: 'new',
          dismissalNote: null,
          events: [
            { kind: 'detected', label: 'Detected', at: '2026-05-19T12:00:00Z', detail: 'SSRF on /api/proxy' },
            { kind: 'trace', label: 'web_request', at: '2026-05-19T12:01:00Z', detail: 'leak', eventType: 'tool.call.completed', seq: 2, isOrigin: true },
            { kind: 'triage', label: 'Triage', at: '2026-05-20T12:00:00Z', detail: 'new' },
          ],
        },
      );
    }
    if (url.includes('/api/runs/') && url.includes('/events')) {
      return jsonResponse(
        map.events ?? [
          {
            id: 'evt-1', run_id: 'run-1', parent_event_id: null, seq: 1,
            type: 'run.started', phase: 'general', status: 'started',
            tool_name: null, output_ref: null, output_preview: 'kickoff',
            started_at: '2026-05-19T12:00:30Z', ended_at: null, duration_ms: null,
            created_at: '2026-05-19T12:00:30Z',
          },
          {
            id: 'evt-2', run_id: 'run-1', parent_event_id: null, seq: 2,
            type: 'tool.call.completed', phase: 'tool', status: 'completed',
            tool_name: 'web_request', output_ref: null, output_preview: 'Server: nginx leaked',
            started_at: '2026-05-19T12:01:00Z', ended_at: null, duration_ms: 120,
            created_at: '2026-05-19T12:01:00Z',
          },
        ],
      );
    }
    if (url.includes('/api/findings')) {
      return jsonResponse(map.findings ?? findings);
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

function renderRoute(initial: string, qc: QueryClient = makeQueryClient()) {
  return render(
    <ToastProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/alerts" element={<AlertsPage />}>
              <Route path=":id" element={<AlertDetailRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ToastProvider>,
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
    renderRoute('/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
    });
    expect(screen.getByText(/SSRF on \/api\/proxy/)).toBeInTheDocument();
    expect(screen.getByText(/TLS allows TLS1\.1/)).toBeInTheDocument();
    const badges = screen.getAllByTestId('severity-badge');
    // 2 in the rows.
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('queue view renders a dense .tbl table with header columns', async () => {
    stubFetch();
    renderRoute('/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
    });
    const list = screen.getByTestId('alerts-list');
    expect(list).toHaveAttribute('data-view', 'queue');
    const table = list.querySelector('table.tbl.zebra.dense');
    expect(table).not.toBeNull();
    expect(screen.getByText('FINDING')).toBeInTheDocument();
    expect(screen.getByText('HOST:PORT')).toBeInTheDocument();
    // One <tr> per finding in tbody.
    expect(screen.getAllByTestId('alerts-row').length).toBe(2);
  });

  it('selected finding row gets the .selected class for the cyan inset', async () => {
    stubFetch();
    renderRoute('/alerts/f-crit');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('alerts-row');
    const selected = rows.find((r) => r.getAttribute('data-finding-id') === 'f-crit');
    expect(selected).toHaveClass('selected');
  });

  it('filter chip restricts the rows to the selected severity', async () => {
    stubFetch();
    renderRoute('/alerts');
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
    renderRoute('/alerts/f-low');
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

  it('drawer shows Evidence Kv, Policy Decision, Suggested Fix, and the four tabs', async () => {
    stubFetch();
    renderRoute('/alerts/f-crit');
    await screen.findByTestId('triage-rail', {}, { timeout: 3000 });
    // Drawer + the four kit tabs.
    expect(screen.getByTestId('alert-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('alert-tab-evidence')).toBeInTheDocument();
    expect(screen.getByTestId('alert-tab-asset')).toBeInTheDocument();
    expect(screen.getByTestId('alert-tab-trace')).toBeInTheDocument();
    expect(screen.getByTestId('alert-tab-history')).toBeInTheDocument();
    // Evidence sections. f-crit has no evidence → PoC placeholder; it has a
    // recommendation → Suggested Fix list renders it.
    expect(screen.getByText('PROOF-OF-CONCEPT')).toBeInTheDocument();
    expect(screen.getByTestId('alert-poc-empty')).toBeInTheDocument();
    expect(screen.getByTestId('alert-policy')).toBeInTheDocument();
    expect(screen.getByTestId('alert-fixes')).toBeInTheDocument();
    expect(screen.getByText(/Validate target URL against an allowlist/)).toBeInTheDocument();
  });

  it('renders the empty state when no findings match the filter', async () => {
    stubFetch({ findings: [] });
    renderRoute('/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-empty')).toBeInTheDocument();
    });
  });

  it('search input filters the findings client-side', async () => {
    stubFetch();
    renderRoute('/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('alerts-search'), { target: { value: 'ssrf' } });
    await waitFor(() => {
      expect(screen.queryByText(/TLS allows TLS1\.1/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/SSRF on \/api\/proxy/)).toBeInTheDocument();
  });

  it('switching to grid view sets data-view=grid; map view clusters by scope', async () => {
    stubFetch();
    renderRoute('/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('alerts-view-grid'));
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toHaveAttribute('data-view', 'grid');
    });
    fireEvent.click(screen.getByTestId('alerts-view-map'));
    await waitFor(() => {
      expect(screen.getByTestId('alerts-map')).toBeInTheDocument();
    });
    // Two distinct assets → two clusters.
    expect(screen.getAllByTestId('alerts-cluster').length).toBeGreaterThanOrEqual(2);
  });

  it('export buttons trigger a download and a success toast', async () => {
    const createUrl = vi.fn(() => 'blob:mock');
    const revokeUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    stubFetch();
    renderRoute('/alerts');
    await waitFor(() => {
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('export-csv-btn'));
    await waitFor(() => {
      expect(createUrl).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(screen.getByTestId('toast')).toHaveAttribute('data-variant', 'success');
    });
    clickSpy.mockRestore();
  });

  it('Asset tab lazily fetches asset detail only when selected', async () => {
    stubFetch();
    renderRoute('/alerts/f-crit');
    await screen.findByTestId('triage-rail', {}, { timeout: 3000 });
    // No asset fetch before the tab is opened.
    const assetCalls = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        (c) => String(c[0]).includes('/api/assets/'),
      );
    expect(assetCalls().length).toBe(0);
    const assetTab = screen.getByTestId('alert-tab-asset');
    fireEvent.mouseDown(assetTab);
    fireEvent.click(assetTab);
    const card = await screen.findByTestId('alert-asset-card', {}, { timeout: 3000 });
    expect(card).toBeInTheDocument();
    expect(assetCalls().length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('app-lab-01')).toBeInTheDocument();
  });

  it('Trace tab renders the run events from /api/runs/:id/events', async () => {
    stubFetch();
    renderRoute('/alerts/f-crit');
    await screen.findByTestId('triage-rail', {}, { timeout: 3000 });
    fireEvent.mouseDown(screen.getByTestId('alert-tab-trace'));
    fireEvent.click(screen.getByTestId('alert-tab-trace'));
    const events = await screen.findByTestId('alert-trace-events', {}, { timeout: 3000 });
    expect(events).toBeInTheDocument();
    // Both stubbed trace events render in the timeline.
    expect(events.querySelector('[data-seq="1"]')).not.toBeNull();
    expect(events.querySelector('[data-seq="2"]')).not.toBeNull();
    expect(screen.getByText('web_request')).toBeInTheDocument();
  });

  it('Trace tab shows the no-run empty state when runId is null', async () => {
    stubFetch({
      findings: [{ ...findings[0], id: 'f-norun', runId: null }],
    });
    renderRoute('/alerts/f-norun');
    await screen.findByTestId('triage-rail', {}, { timeout: 3000 });
    fireEvent.mouseDown(screen.getByTestId('alert-tab-trace'));
    fireEvent.click(screen.getByTestId('alert-tab-trace'));
    expect(await screen.findByTestId('alert-trace-empty')).toBeInTheDocument();
  });

  it('History tab renders the reconstructed lifecycle from /api/findings/:id/history', async () => {
    stubFetch();
    renderRoute('/alerts/f-crit');
    await screen.findByTestId('triage-rail', {}, { timeout: 3000 });
    fireEvent.mouseDown(screen.getByTestId('alert-tab-history'));
    fireEvent.click(screen.getByTestId('alert-tab-history'));
    const history = await screen.findByTestId('alert-history', {}, { timeout: 3000 });
    expect(history).toBeInTheDocument();
    // Detected + trace + triage rows from the stubbed history (wait for the
    // async fetch to resolve and the rows to render).
    await waitFor(() => {
      expect(history.querySelector('[data-kind="detected"]')).not.toBeNull();
    });
    expect(history.querySelector('[data-kind="trace"][data-origin="true"]')).not.toBeNull();
    expect(history.querySelector('[data-kind="triage"]')).not.toBeNull();
  });
});
