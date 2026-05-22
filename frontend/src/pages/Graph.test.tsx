// GraphPage — A8.5b read-only SVG renderer. Verifies the no-run hint,
// the run-context count badges, the bare-path links, and that the
// GraphCanvas SVG renders nodes/edges when graph data is present.
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
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

    // Kit graph chrome: toolbar (search + view switch + toggles), the
    // bottom-left legend overlay, and the bottom-right zoom widget pill.
    expect(screen.getByTestId('graph-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('graph-search')).toBeInTheDocument();
    expect(screen.getByTestId('graph-blocked-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('graph-legend')).toBeInTheDocument();
    expect(screen.getByTestId('graph-zoom-widget')).toBeInTheDocument();
    expect(within(screen.getByTestId('graph-legend')).getByText('blocked')).toBeInTheDocument();

    // Orthogonal edges render as <path> with the graph-edge testid.
    expect(screen.getAllByTestId('graph-edge').length).toBe(2);
  });

  it('selects a node and populates the inspector drawer', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-cccc3333/graph')) {
        return jsonResponse({
          nodes: [
            { id: 'run:r1', type: 'run', label: 'recon run', status: 'completed' },
            {
              id: 'tool:t1',
              type: 'tool',
              label: 'nmap',
              status: 'completed',
              metadata: { command: 'nmap -sV 10.0.0.1', output: 'PORT 443 open' },
            },
          ],
          edges: [{ id: 'e1', type: 'called', source: 'run:r1', target: 'tool:t1' }],
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(
      withToast(
        <Routes>
          <Route path="/graph/:runId" element={<GraphPage />} />
        </Routes>,
      ),
      { route: '/graph/run-cccc3333' },
    );

    await waitFor(() => {
      expect(screen.getByTestId('graph-canvas')).toBeInTheDocument();
    });

    // Inspector starts empty.
    expect(screen.getByText(/No node selected/i)).toBeInTheDocument();

    // Click the nmap tool node → inspector populates with its command.
    const toolNode = screen
      .getAllByTestId('graph-node')
      .find((g) => g.getAttribute('data-node-type') === 'tool')!;
    fireEvent.click(toolNode);

    await waitFor(() => {
      expect(screen.getByTestId('graph-inspector-title')).toHaveTextContent('nmap');
    });
    expect(screen.getByText(/nmap -sV 10.0.0.1/)).toBeInTheDocument();
    expect(screen.getByText(/PORT 443 open/)).toBeInTheDocument();
  });

  it('hides blocked edges when the show-blocked toggle is turned off', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-dddd4444/graph')) {
        return jsonResponse({
          nodes: [
            { id: 'run:r1', type: 'run', label: 'run', status: 'running' },
            { id: 'tool:t1', type: 'tool', label: 'allowed', status: 'completed' },
            { id: 'cmd:c1', type: 'command', label: 'blocked-cmd', status: 'blocked' },
          ],
          edges: [
            { id: 'e1', type: 'called', source: 'run:r1', target: 'tool:t1' },
            { id: 'e2', type: 'blocked_by_policy', source: 'run:r1', target: 'cmd:c1' },
          ],
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(
      withToast(
        <Routes>
          <Route path="/graph/:runId" element={<GraphPage />} />
        </Routes>,
      ),
      { route: '/graph/run-dddd4444' },
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('graph-edge').length).toBe(2);
    });

    // Toggling show-blocked off removes the policy-blocked edge.
    fireEvent.click(screen.getByTestId('graph-blocked-toggle'));
    await waitFor(() => {
      expect(screen.getAllByTestId('graph-edge').length).toBe(1);
    });
  });

  it('dims non-matching nodes when the toolbar search is used', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-search1/graph')) {
        return jsonResponse({
          nodes: [
            { id: 'run:r1', type: 'run', label: 'recon run', status: 'completed' },
            { id: 'tool:t1', type: 'tool', label: 'nmap', status: 'completed' },
            { id: 'host:h1', type: 'host', label: '10.0.0.1', status: 'observed' },
          ],
          edges: [{ id: 'e1', type: 'called', source: 'run:r1', target: 'tool:t1' }],
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(
      withToast(
        <Routes>
          <Route path="/graph/:runId" element={<GraphPage />} />
        </Routes>,
      ),
      { route: '/graph/run-search1' },
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('graph-node')).toHaveLength(3);
    });
    // No search → nothing dimmed.
    expect(
      screen.getAllByTestId('graph-node').some((g) => g.getAttribute('data-node-dimmed') === 'true'),
    ).toBe(false);

    // Type a query matching only the nmap tool node.
    fireEvent.change(screen.getByTestId('graph-search'), { target: { value: 'nmap' } });

    await waitFor(() => {
      const dimmed = screen
        .getAllByTestId('graph-node')
        .filter((g) => g.getAttribute('data-node-dimmed') === 'true');
      // run + host dimmed; the matching nmap node stays at full opacity.
      expect(dimmed).toHaveLength(2);
    });
    const lit = screen
      .getAllByTestId('graph-node')
      .filter((g) => !g.getAttribute('data-node-dimmed'));
    expect(lit).toHaveLength(1);
    expect(lit[0]?.getAttribute('data-node-type')).toBe('tool');
  });

  it('filters node types when switching to the Topology view', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-view1/graph')) {
        return jsonResponse({
          nodes: [
            { id: 'run:r1', type: 'run', label: 'recon run', status: 'completed' },
            { id: 'tool:t1', type: 'tool', label: 'nmap', status: 'completed' },
            { id: 'host:h1', type: 'host', label: '10.0.0.1', status: 'observed' },
            { id: 'port:p1', type: 'port', label: '443/tcp', status: 'observed' },
          ],
          edges: [
            { id: 'e1', type: 'called', source: 'run:r1', target: 'tool:t1' },
            { id: 'e2', type: 'observed', source: 'tool:t1', target: 'host:h1' },
            { id: 'e3', type: 'observed', source: 'host:h1', target: 'port:p1' },
          ],
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(
      withToast(
        <Routes>
          <Route path="/graph/:runId" element={<GraphPage />} />
        </Routes>,
      ),
      { route: '/graph/run-view1' },
    );

    // Run view (default) renders every node type.
    await waitFor(() => {
      expect(screen.getAllByTestId('graph-node')).toHaveLength(4);
    });

    // Switch to Topology → run + tool node types are dropped from layout.
    fireEvent.click(screen.getByRole('button', { name: 'Topology' }));

    await waitFor(() => {
      expect(screen.getAllByTestId('graph-node')).toHaveLength(2);
    });
    const types = screen
      .getAllByTestId('graph-node')
      .map((g) => g.getAttribute('data-node-type'))
      .sort();
    expect(types).toEqual(['host', 'port']);
  });

  it('advances the active replay node + step counter when Step is pressed', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-replay1/graph')) {
        return jsonResponse({
          nodes: [
            { id: 'run:r1', type: 'run', label: 'recon run', status: 'completed', seq: 0 },
            { id: 'tool:t1', type: 'tool', label: 'nmap', status: 'completed', seq: 1 },
            { id: 'host:h1', type: 'host', label: '10.0.0.1', status: 'observed', seq: 2 },
          ],
          edges: [
            { id: 'e1', type: 'called', source: 'run:r1', target: 'tool:t1' },
            { id: 'e2', type: 'observed', source: 'tool:t1', target: 'host:h1' },
          ],
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(
      withToast(
        <Routes>
          <Route path="/graph/:runId" element={<GraphPage />} />
        </Routes>,
      ),
      { route: '/graph/run-replay1' },
    );

    await waitFor(() => {
      expect(screen.getByTestId('graph-canvas')).toBeInTheDocument();
    });

    // Cursor starts at 0 → first node (run) is active, counter reads 01 / 03.
    const counter = screen.getByTestId('graph-replay-counter');
    expect(counter).toHaveTextContent('STEP 01 / 03');
    const activeStart = screen
      .getAllByTestId('graph-node')
      .filter((g) => g.getAttribute('data-node-active') === 'true');
    expect(activeStart).toHaveLength(1);
    expect(activeStart[0]?.getAttribute('data-node-type')).toBe('run');

    // Step forward → cursor advances to the tool node, counter to 02 / 03.
    fireEvent.click(screen.getByTestId('graph-replay-step'));
    await waitFor(() => {
      expect(screen.getByTestId('graph-replay-counter')).toHaveTextContent('STEP 02 / 03');
    });
    const activeNext = screen
      .getAllByTestId('graph-node')
      .filter((g) => g.getAttribute('data-node-active') === 'true');
    expect(activeNext).toHaveLength(1);
    expect(activeNext[0]?.getAttribute('data-node-type')).toBe('tool');

    // Step again → host node; the Step button then disables at the end.
    fireEvent.click(screen.getByTestId('graph-replay-step'));
    await waitFor(() => {
      expect(screen.getByTestId('graph-replay-counter')).toHaveTextContent('STEP 03 / 03');
    });
    expect(screen.getByTestId('graph-replay-step')).toBeDisabled();

    // Reset → back to the first node / 01 / 03.
    fireEvent.click(screen.getByTestId('graph-replay-reset'));
    await waitFor(() => {
      expect(screen.getByTestId('graph-replay-counter')).toHaveTextContent('STEP 01 / 03');
    });
    const activeReset = screen
      .getAllByTestId('graph-node')
      .filter((g) => g.getAttribute('data-node-active') === 'true');
    expect(activeReset[0]?.getAttribute('data-node-type')).toBe('run');
  });

  it('moves the replay cursor to a node selected in the canvas and pauses', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/runs/run-replay2/graph')) {
        return jsonResponse({
          nodes: [
            { id: 'run:r1', type: 'run', label: 'recon run', status: 'completed', seq: 0 },
            { id: 'tool:t1', type: 'tool', label: 'nmap', status: 'completed', seq: 1 },
          ],
          edges: [{ id: 'e1', type: 'called', source: 'run:r1', target: 'tool:t1' }],
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(
      withToast(
        <Routes>
          <Route path="/graph/:runId" element={<GraphPage />} />
        </Routes>,
      ),
      { route: '/graph/run-replay2' },
    );

    await waitFor(() => {
      expect(screen.getByTestId('graph-canvas')).toBeInTheDocument();
    });
    expect(screen.getByTestId('graph-replay-counter')).toHaveTextContent('STEP 01 / 02');

    // Click the tool node → cursor jumps to it (counter 02 / 02) + selected.
    const toolNode = screen
      .getAllByTestId('graph-node')
      .find((g) => g.getAttribute('data-node-type') === 'tool')!;
    fireEvent.click(toolNode);

    await waitFor(() => {
      expect(screen.getByTestId('graph-replay-counter')).toHaveTextContent('STEP 02 / 02');
    });
    const active = screen
      .getAllByTestId('graph-node')
      .filter((g) => g.getAttribute('data-node-active') === 'true');
    expect(active[0]?.getAttribute('data-node-type')).toBe('tool');
    expect(screen.getByTestId('graph-inspector-title')).toHaveTextContent('nmap');
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
