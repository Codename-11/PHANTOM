// GraphPage — A8.5b read-only SVG renderer. Verifies the no-run hint,
// the run-context count badges, the bare-path links, and that the
// GraphCanvas SVG renders nodes/edges when graph data is present.
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/components/ui/toast';
import GraphPage from './Graph';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// GraphPage uses useToast, which requires a ToastProvider ancestor.
function withToast(ui: ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
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
    renderWithProviders(withToast(<GraphPage />), { route: '/graph' });

    expect(screen.getByRole('heading', { level: 1, name: /Graph/i })).toBeInTheDocument();
    expect(screen.getByText(/No run selected/i)).toBeInTheDocument();
    // Legacy graph link points at /graph with no params.
    expect(screen.getByTestId('open-legacy-graph')).toHaveAttribute('href', '/graph');
    // Back-to-runs uses the bare path, not /react/runs.
    expect(screen.getByTestId('back-to-runs-btn')).toHaveAttribute('href', '/runs');
    // No run → no canvas card.
    expect(screen.queryByTestId('graph-canvas-card')).not.toBeInTheDocument();
  });

  it('renders the SVG node-link diagram from the path-param runId', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-aaaa1111/graph')) {
        return jsonResponse({
          nodes: [
            { id: 'run:r1', type: 'run', label: 'recon run', status: 'completed' },
            { id: 'tool:t1', type: 'tool', label: 'nmap', status: 'completed' },
            { id: 'host:h1', type: 'host', label: '10.0.0.1', status: 'observed' },
          ],
          edges: [
            { id: 'e1', type: 'called', source: 'run:r1', target: 'tool:t1' },
            { id: 'e2', type: 'observed', source: 'tool:t1', target: 'host:h1' },
          ],
        });
      }
      if (u.startsWith('/api/runs/run-aaaa1111/events')) return jsonResponse([]);
      if (u.startsWith('/api/artifacts')) return jsonResponse([]);
      return jsonResponse({});
    }) as unknown as typeof fetch;

    renderWithProviders(
      withToast(
        <Routes>
          <Route path="/graph/:runId" element={<GraphPage />} />
        </Routes>,
      ),
      { route: '/graph/run-aaaa1111' },
    );

    await waitFor(() => {
      expect(screen.getByText(/3 nodes/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 edges/i)).toBeInTheDocument();

    // SVG canvas renders the nodes + edges from the layout.
    await waitFor(() => {
      expect(screen.getByTestId('graph-canvas')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('graph-node')).toHaveLength(3);
    // The node labels are present in the SVG (text + <title> both carry it).
    expect(screen.getAllByText(/nmap/).length).toBeGreaterThan(0);

    // Legacy graph link includes the runId so a click-through follows context.
    expect(screen.getByTestId('open-legacy-graph')).toHaveAttribute(
      'href',
      '/graph?runId=run-aaaa1111',
    );
  });

  it('reads the runId from a ?runId= query param when no path param is present', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-bbbb2222/graph')) {
        return jsonResponse({
          nodes: [{ id: 'run:r1', type: 'run', label: 'solo run' }],
          edges: [],
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(withToast(<GraphPage />), { route: '/graph?runId=run-bbbb2222' });

    await waitFor(() => {
      expect(screen.getByText(/1 nodes/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('open-legacy-graph')).toHaveAttribute(
      'href',
      '/graph?runId=run-bbbb2222',
    );
  });
});
