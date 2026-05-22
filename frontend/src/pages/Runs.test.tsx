// RunsPage tests — empty + populated list, tab switching surfaces the
// right Sheet pane. Detail Sheet content is exercised separately by
// mounting the detail route inline.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/components/ui/toast';
import RunsPage, { RunDetailRoute } from './Runs';

interface FetchInit { method?: string; body?: string; headers?: HeadersInit }
type FetchFn = (url: string, init?: FetchInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeSynthesis(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    v: 1,
    runId: 'run-aaaa1111',
    title: 'Map admin portal',
    status: 'completed',
    goal: 'Find every admin URL exposed to the lab subnet.',
    outcome: 'Completed · 3 ok · 1 blocked · posture 68/100 (fair)',
    startedAt: '2026-05-20T12:00:00Z',
    endedAt: '2026-05-20T12:04:00Z',
    durationMs: 240000,
    scope: { id: 'scope-a', name: 'Lab subnet', status: 'active', expiresAt: null },
    objectives: { stated: 'Sweep lab', met: 'partial', signal: 'Completed with 1 blocked action.' },
    activity: {
      events: 5,
      toolCalls: { total: 4, succeeded: 3, failed: 0, blocked: 1 },
      artifacts: 1,
      errors: [],
    },
    risk: { highest: 'medium', distribution: { critical: 0, high: 0, medium: 2, low: 3 }, blockedHighRisk: 0 },
    findings: { total: 2, bySeverity: { critical: 0, high: 1, medium: 1, low: 0 }, new: 2, resolved: 0 },
    posture: { score: 68, delta: 4, components: { coverage: 75, risk: 60, hygiene: 70 }, rating: 'fair' },
    highlights: [
      { kind: 'win', text: '3 tool calls completed successfully.' },
      { kind: 'risk', text: '1 action blocked by scope policy.' },
    ],
    nextSteps: [
      { kind: 'review', text: 'Review blocked actions in the trace.', action: 'review-trace' },
    ],
    policy: { mode: 'governed', approvals: { granted: 1, denied: 0, allowOnce: 0, override: 0, timeout: 0 } },
    ...over,
  };
}

function makeEvent(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
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
    ...over,
  };
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
    expect(link).toHaveAttribute('href', '/runs/run-aaaa1111');
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
      if (u === '/api/runs/run-aaaa1111/synthesis') {
        return jsonResponse(makeSynthesis());
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
      <ToastProvider>
        <Routes>
          <Route path="/react/runs" element={<RunsPage />}>
            <Route path=":id" element={<RunDetailRoute />} />
          </Route>
        </Routes>
      </ToastProvider>,
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

  it('renders the detail inline as a master-detail split — run list stays visible beside it', async () => {
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs?')) return jsonResponse([makeRun()]);
      if (u === '/api/runs/run-aaaa1111') {
        return jsonResponse({ ...makeRun(), events: [], artifacts: [] });
      }
      if (u.startsWith('/api/runs/run-aaaa1111/events')) return jsonResponse([]);
      if (u === '/api/runs/run-aaaa1111/synthesis') return jsonResponse(makeSynthesis());
      return jsonResponse({ error: 'unhandled' }, 404);
    };
    globalThis.fetch = vi.fn(fetchMock as unknown as typeof fetch) as unknown as typeof fetch;

    renderWithProviders(
      <ToastProvider>
        <Routes>
          <Route path="/react/runs" element={<RunsPage />}>
            <Route path=":id" element={<RunDetailRoute />} />
          </Route>
        </Routes>
      </ToastProvider>,
      { route: '/react/runs/run-aaaa1111' },
    );

    // The run list stays visible alongside the inline detail (master-detail),
    // not hidden behind a modal Sheet.
    await waitFor(() => {
      expect(screen.getByTestId('runs-list')).toBeInTheDocument();
    });
    // Inline detail panel mounts beside it once the run resolves.
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });
    // The title appears in both the list row and the detail header (proof the
    // list is not unmounted behind a modal).
    expect(screen.getAllByText('Map admin portal').length).toBeGreaterThanOrEqual(2);
  });

  it('close button navigates back to the list (deep-link reversible)', async () => {
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs?')) return jsonResponse([makeRun()]);
      if (u === '/api/runs/run-aaaa1111') {
        return jsonResponse({ ...makeRun(), events: [], artifacts: [] });
      }
      if (u.startsWith('/api/runs/run-aaaa1111/events')) return jsonResponse([]);
      if (u === '/api/runs/run-aaaa1111/synthesis') return jsonResponse(makeSynthesis());
      return jsonResponse({ error: 'unhandled' }, 404);
    };
    globalThis.fetch = vi.fn(fetchMock as unknown as typeof fetch) as unknown as typeof fetch;

    // Mount the production /runs parent too so the close affordance's
    // navigate('/runs') resolves back to the list (deep-link reversible).
    renderWithProviders(
      <ToastProvider>
        <Routes>
          <Route path="/runs" element={<RunsPage />}>
            <Route path=":id" element={<RunDetailRoute />} />
          </Route>
        </Routes>
      </ToastProvider>,
      { route: '/runs/run-aaaa1111' },
    );

    const closeBtn = await screen.findByTestId('run-detail-close');
    await act(async () => {
      fireEvent.click(closeBtn);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('run-detail-panel')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('runs-list')).toBeInTheDocument();
  });

  it('detail panel renders the error banner when run fetch fails', async () => {
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

  it('Synthesis tab renders the LLM-enriched synthesis card from /synthesis', async () => {
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs?')) return jsonResponse([makeRun()]);
      if (u === '/api/runs/run-aaaa1111') {
        return jsonResponse({ ...makeRun(), events: [], artifacts: [] });
      }
      if (u.startsWith('/api/runs/run-aaaa1111/events')) return jsonResponse([]);
      if (u === '/api/runs/run-aaaa1111/synthesis') {
        return jsonResponse(makeSynthesis({ enrichment: { source: 'llm', generatedAt: '2026-05-20T12:05:00Z' } }));
      }
      return jsonResponse({ error: 'unhandled' }, 404);
    };
    globalThis.fetch = vi.fn(fetchMock as unknown as typeof fetch) as unknown as typeof fetch;

    renderWithProviders(
      <ToastProvider>
        <Routes>
          <Route path="/react/runs" element={<RunsPage />}>
            <Route path=":id" element={<RunDetailRoute />} />
          </Route>
        </Routes>
      </ToastProvider>,
      { route: '/react/runs/run-aaaa1111' },
    );

    // Synthesis is the default tab — the enriched card replaces the old
    // run.summary preview.
    await waitFor(() => {
      expect(screen.getByTestId('synthesis-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('synthesis-outcome')).toHaveTextContent(/posture 68\/100/);
    // Posture ring + highlights surface from the v1 shape.
    expect(screen.getByTestId('synthesis-posture-ring')).toBeInTheDocument();
    expect(screen.getByTestId('synthesis-highlights')).toHaveTextContent(/blocked by scope policy/);
    // The enrichment marker badge renders when the LLM enriched the card.
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('Trace tab replay scrubber steps through events chronologically', async () => {
    const events = [
      makeEvent({ id: 'e1', seq: 1, type: 'run.started', status: 'started' }),
      makeEvent({ id: 'e2', seq: 2, type: 'tool.call.started', status: 'started', tool_name: 'http.get' }),
      makeEvent({ id: 'e3', seq: 3, type: 'tool.call.blocked', status: 'blocked', tool_name: 'rm' }),
      makeEvent({ id: 'e4', seq: 4, type: 'run.completed', status: 'completed' }),
    ];
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs?')) return jsonResponse([makeRun()]);
      if (u === '/api/runs/run-aaaa1111') {
        return jsonResponse({ ...makeRun(), events, artifacts: [] });
      }
      if (u.startsWith('/api/runs/run-aaaa1111/events')) return jsonResponse(events);
      if (u === '/api/runs/run-aaaa1111/synthesis') return jsonResponse(makeSynthesis());
      return jsonResponse({ error: 'unhandled' }, 404);
    };
    globalThis.fetch = vi.fn(fetchMock as unknown as typeof fetch) as unknown as typeof fetch;

    renderWithProviders(
      <ToastProvider>
        <Routes>
          <Route path="/react/runs" element={<RunsPage />}>
            <Route path=":id" element={<RunDetailRoute />} />
          </Route>
        </Routes>
      </ToastProvider>,
      { route: '/react/runs/run-aaaa1111' },
    );

    // Switch to the Trace tab where the scrubber lives.
    const traceTab = await screen.findByRole('tab', { name: /Trace/i });
    await act(async () => {
      traceTab.focus();
      fireEvent.keyDown(traceTab, { key: 'Enter' });
      fireEvent.keyUp(traceTab, { key: 'Enter' });
      fireEvent.click(traceTab);
    });

    await waitFor(() => {
      expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument();
    });

    // Counter starts at 00 / 04 and a blocked marker sits on the track.
    expect(screen.getByTestId('replay-counter')).toHaveTextContent('00 / 04');
    expect(screen.getByTestId('replay-blocked-mark')).toBeInTheDocument();

    // Stepping advances one event at a time.
    const stepBtn = screen.getByRole('button', { name: /Step/i });
    await act(async () => {
      fireEvent.click(stepBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('replay-counter')).toHaveTextContent('01 / 04');
    });
    expect(screen.getByTestId('replay-current')).toHaveTextContent('run.started');

    await act(async () => {
      fireEvent.click(stepBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('replay-counter')).toHaveTextContent('02 / 04');
    });
    expect(screen.getByTestId('replay-current')).toHaveTextContent('http.get');

    // The range input scrubs directly to a position.
    const range = screen.getByTestId('replay-range');
    await act(async () => {
      fireEvent.change(range, { target: { value: '4' } });
    });
    await waitFor(() => {
      expect(screen.getByTestId('replay-counter')).toHaveTextContent('04 / 04');
    });

    // Reset returns to the start.
    const resetBtn = screen.getByRole('button', { name: /Reset/i });
    await act(async () => {
      fireEvent.click(resetBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('replay-counter')).toHaveTextContent('00 / 04');
    });
  });
});
