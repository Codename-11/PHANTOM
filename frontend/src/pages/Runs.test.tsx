// RunsPage tests — empty + populated list, tab switching surfaces the
// right Sheet pane. Detail Sheet content is exercised separately by
// mounting the detail route inline.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { renderWithProviders } from '@/test/test-utils';
import RunsPage, { RunDetailRoute } from './Runs';

interface FetchInit { method?: string; body?: string; headers?: HeadersInit }
type FetchFn = (url: string, init?: FetchInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeRun(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'run-aaaa1111',
    conversation_id: 'conv-1',
    title: 'Map admin portal',
    goal: 'Find every admin URL exposed to the lab subnet.',
    status: 'running',
    model: 'gpt-4o-mini',
    provider_route: 'openai',
    scope_id: 'scope-a',
    risk_level: 'medium',
    summary: null,
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    ended_at: null,
    prompt_snapshot: null,
    scope: { id: 'scope-a', name: 'Lab subnet', expires_at: null, archived_at: null },
    ...over,
  };
}

describe('RunsPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the empty state when no runs exist', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;

    renderWithProviders(<RunsPage />, { route: '/react/runs' });

    expect(screen.getByRole('heading', { level: 1, name: /Runs/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('runs-empty')).toBeInTheDocument();
    });
  });

  it('renders one row per run with status pill + meta', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        makeRun(),
        makeRun({ id: 'run-bbbb2222', title: 'Recon pass', status: 'completed' }),
      ]),
    ) as unknown as typeof fetch;

    renderWithProviders(<RunsPage />, { route: '/react/runs' });

    await waitFor(() => {
      expect(screen.getByText('Map admin portal')).toBeInTheDocument();
    });
    expect(screen.getByText('Recon pass')).toBeInTheDocument();
    // Status pills.
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    // Row link points at the detail route.
    const link = screen.getByRole('link', { name: /Open Map admin portal/i });
    expect(link).toHaveAttribute('href', '/react/runs/run-aaaa1111');
  });

  it('shows the error banner on a failed fetch', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'boom' }, 500),
    ) as unknown as typeof fetch;

    renderWithProviders(<RunsPage />, { route: '/react/runs' });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load runs/);
  });

  it('detail Sheet renders synthesis tab by default and tab clicks surface the right pane', async () => {
    // Route URL responses:
    //   /api/runs            → list
    //   /api/runs/:id        → detail (incl events + artifacts)
    //   /api/runs/:id/events → trace events
    //   /api/runs/:id/evidence → evidence bundle
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs?')) return jsonResponse([makeRun()]);
      if (u === '/api/runs/run-aaaa1111') {
        return jsonResponse({
          ...makeRun(),
          events: [
            {
              id: 'e1',
              run_id: 'run-aaaa1111',
              parent_event_id: null,
              seq: 1,
              type: 'run.started',
              phase: 'init',
              status: 'started',
              tool_name: null,
              output_ref: null,
              output_preview: null,
              metadata: null,
              started_at: null,
              ended_at: null,
              duration_ms: null,
              created_at: '2026-05-20T12:00:00Z',
            },
          ],
          artifacts: [
            {
              id: 'art-12345678',
              runId: 'run-aaaa1111',
              conversationId: null,
              type: 'markdown',
              title: 'Pentest report',
              mimeType: 'text/markdown',
              createdAt: '2026-05-20T12:05:00Z',
              publishedAt: null,
              contentUrl: '/api/artifacts/art-12345678/content',
              downloadUrl: '/api/artifacts/art-12345678/download',
            },
          ],
        });
      }
      if (u.startsWith('/api/runs/run-aaaa1111/events')) {
        return jsonResponse([]);
      }
      if (u === '/api/runs/run-aaaa1111/evidence') {
        return jsonResponse({
          run: { id: 'run-aaaa1111', title: 'Map admin portal', goal: null, status: 'running', model: null, provider_route: null, conversation_id: null, scope_id: null, risk_level: null, started_at: null, ended_at: null, summary: null, notes: null },
          scope: null,
          promptSnapshot: null,
          artifacts: [],
          findings: [],
          events: [],
          summary: { eventCount: 1, toolCalls: 0, blockedCount: 0, findingCount: 0, artifactCount: 1, errorCount: 0 },
          generatedAt: '2026-05-20T12:10:00Z',
        });
      }
      return jsonResponse({ error: 'unhandled' }, 404);
    };
    globalThis.fetch = vi.fn(fetchMock as unknown as typeof fetch) as unknown as typeof fetch;

    renderWithProviders(
      <Routes>
        <Route path="/react/runs" element={<RunsPage />}>
          <Route path=":id" element={<RunDetailRoute />} />
        </Route>
      </Routes>,
      { route: '/react/runs/run-aaaa1111' },
    );

    // Sheet shows up with the title and the Radix tabs.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Synthesis/i })).toBeInTheDocument();
    });
    // Synthesis tab is selected by default.
    expect(screen.getByRole('tab', { name: /Synthesis/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Click the Artifacts tab — Radix listens to keyDown for tab activation
    // in test envs where pointer-events on the Sheet overlay block click;
    // we trigger both for resilience.
    const artifactsTab = screen.getByRole('tab', { name: /Artifacts/i });
    await act(async () => {
      artifactsTab.focus();
      fireEvent.keyDown(artifactsTab, { key: 'Enter' });
      fireEvent.keyUp(artifactsTab, { key: 'Enter' });
      fireEvent.click(artifactsTab);
    });
    await waitFor(() => {
      expect(artifactsTab).toHaveAttribute('aria-selected', 'true');
    });
    await waitFor(() => {
      expect(screen.getByTestId('run-artifacts-list')).toBeInTheDocument();
    });
    expect(screen.getByText('Pentest report')).toBeInTheDocument();

    // The Evidence tab triggers the evidence fetch + renders the KPI grid.
    const evidenceTab = screen.getByRole('tab', { name: /Evidence/i });
    await act(async () => {
      evidenceTab.focus();
      fireEvent.keyDown(evidenceTab, { key: 'Enter' });
      fireEvent.keyUp(evidenceTab, { key: 'Enter' });
      fireEvent.click(evidenceTab);
    });
    await waitFor(() => {
      expect(evidenceTab).toHaveAttribute('aria-selected', 'true');
    });
    await waitFor(() => {
      expect(screen.getByTestId('evidence-pane')).toBeInTheDocument();
    });
  });

  it('detail Sheet renders the error banner when run fetch fails', async () => {
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs?')) return jsonResponse([]);
      return jsonResponse({ error: 'not found' }, 404);
    };
    globalThis.fetch = vi.fn(fetchMock as unknown as typeof fetch) as unknown as typeof fetch;

    renderWithProviders(<RunDetailRoute />, { route: '/react/runs/missing' });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
    });
  });
});
