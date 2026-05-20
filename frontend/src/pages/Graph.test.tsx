// GraphPage — chrome-only React surface. The interactive canvas
// renderer stays on the legacy /graph page; we just verify the toolbar
// + run context Card show the right pieces.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { renderWithProviders } from '@/test/test-utils';
import GraphPage from './Graph';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GraphPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the no-run hint when called without a runId', () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ nodes: [], edges: [] })) as unknown as typeof fetch;
    renderWithProviders(<GraphPage />, { route: '/react/graph' });

    expect(screen.getByRole('heading', { level: 1, name: /Graph/i })).toBeInTheDocument();
    expect(screen.getByText(/No run selected/i)).toBeInTheDocument();
    // Legacy graph link points at /graph with no params.
    expect(screen.getByTestId('open-legacy-graph')).toHaveAttribute('href', '/graph');
  });

  it('reads the runId from the path param and surfaces nodes/edges counts', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-aaaa1111/graph')) {
        return jsonResponse({
          nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
          edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
        });
      }
      if (u.startsWith('/api/runs/run-aaaa1111/events')) return jsonResponse([]);
      if (u.startsWith('/api/artifacts')) return jsonResponse([]);
      return jsonResponse({});
    }) as unknown as typeof fetch;

    renderWithProviders(
      <Routes>
        <Route path="/react/graph/:runId" element={<GraphPage />} />
      </Routes>,
      { route: '/react/graph/run-aaaa1111' },
    );

    await waitFor(() => {
      expect(screen.getByText(/3 nodes/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 edges/i)).toBeInTheDocument();
    // Legacy graph link includes the runId so a click-through follows context.
    expect(screen.getByTestId('open-legacy-graph')).toHaveAttribute(
      'href',
      '/graph?runId=run-aaaa1111',
    );
    // Canvas placeholder card surfaces the deferred-renderer note.
    expect(screen.getByTestId('graph-canvas-placeholder')).toBeInTheDocument();
  });

  it('reads the runId from a ?runId= query param when no path param is present', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-bbbb2222/graph')) {
        return jsonResponse({ nodes: [{ id: 'n1' }], edges: [] });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(<GraphPage />, { route: '/react/graph?runId=run-bbbb2222' });

    await waitFor(() => {
      expect(screen.getByText(/1 nodes/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('open-legacy-graph')).toHaveAttribute(
      'href',
      '/graph?runId=run-bbbb2222',
    );
  });
});
