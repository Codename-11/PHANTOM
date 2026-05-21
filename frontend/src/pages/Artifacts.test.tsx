// ArtifactsPage — list renders + filter chip restricts visible rows.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, act, fireEvent, within } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import ArtifactsPage from './Artifacts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function art(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'art-aaaa1111',
    runId: 'run-aaaa1111',
    conversationId: 'conv-1',
    type: 'markdown',
    title: 'Pentest report',
    mimeType: 'text/markdown',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    publishedAt: null,
    contentUrl: '/api/artifacts/art-aaaa1111/content',
    downloadUrl: '/api/artifacts/art-aaaa1111/download',
    ...over,
  };
}

describe('ArtifactsPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the empty state when no artifacts exist', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;

    renderWithProviders(<ArtifactsPage />, { route: '/react/artifacts' });

    expect(screen.getByRole('heading', { level: 1, name: /Artifacts/i }))
      .toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('artifacts-empty')).toBeInTheDocument();
    });
  });

  it('renders one row per artifact with the expected columns', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        art(),
        art({ id: 'art-bbbb2222', title: 'Evidence bundle', type: 'evidence' }),
      ]),
    ) as unknown as typeof fetch;

    renderWithProviders(<ArtifactsPage />, { route: '/react/artifacts' });

    await waitFor(() => {
      expect(screen.getByTestId('artifacts-table')).toBeInTheDocument();
    });
    expect(screen.getByText('Pentest report')).toBeInTheDocument();
    expect(screen.getByText('Evidence bundle')).toBeInTheDocument();
    // Run id link points at the bare detail route /runs/:id.
    const runLinks = screen.getAllByRole('link', { name: /run-aaaa/i });
    expect(runLinks[0]).toHaveAttribute('href', '/runs/run-aaaa1111');
    // Filter chips show counts.
    const reportsChip = screen.getByRole('button', { name: /Reports/i });
    expect(reportsChip).toHaveAttribute('data-artifact-filter', 'reports');
  });

  it('filter chip restricts the rows to the selected bucket', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        art({ id: 'art-md', type: 'markdown', title: 'Pentest report' }),
        art({ id: 'art-evi', type: 'evidence', title: 'Evidence bundle' }),
        art({ id: 'art-html', type: 'html', title: 'Local preview' }),
      ]),
    ) as unknown as typeof fetch;

    renderWithProviders(<ArtifactsPage />, { route: '/react/artifacts' });

    await waitFor(() => {
      expect(screen.getByText('Pentest report')).toBeInTheDocument();
    });
    // Both rows visible initially under the All chip.
    expect(screen.getByText('Evidence bundle')).toBeInTheDocument();
    expect(screen.getByText('Local preview')).toBeInTheDocument();

    // Click "Evidence" chip — should hide the markdown + html rows.
    // Scope by the chip's data attribute: "Evidence bundle" row titles are
    // also buttons now (they open the preview), so a name regex collides.
    const chipRow = screen.getByTestId('artifacts-filter-chips');
    const chip = within(chipRow).getByRole('button', { name: /Evidence/i });
    await act(async () => {
      fireEvent.click(chip);
    });
    await waitFor(() => {
      expect(chip).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.queryByText('Pentest report')).not.toBeInTheDocument();
    expect(screen.queryByText('Local preview')).not.toBeInTheDocument();
    expect(screen.getByText('Evidence bundle')).toBeInTheDocument();

    // Click "Other" chip — only the html row should remain.
    const otherChip = within(chipRow).getByRole('button', { name: /Other/i });
    await act(async () => {
      fireEvent.click(otherChip);
    });
    await waitFor(() => {
      expect(otherChip).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.queryByText('Pentest report')).not.toBeInTheDocument();
    expect(screen.queryByText('Evidence bundle')).not.toBeInTheDocument();
    expect(screen.getByText('Local preview')).toBeInTheDocument();
  });

  it('renders the filtered-empty hint when the active chip has zero matches', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([art({ id: 'art-md', type: 'markdown', title: 'Pentest report' })]),
    ) as unknown as typeof fetch;

    renderWithProviders(<ArtifactsPage />, { route: '/react/artifacts' });

    await waitFor(() => {
      expect(screen.getByText('Pentest report')).toBeInTheDocument();
    });
    // Switch to the Evidence chip — there are no evidence-type artifacts.
    const evidenceChip = screen.getByRole('button', { name: /Evidence/i });
    await act(async () => {
      fireEvent.click(evidenceChip);
    });
    await waitFor(() => {
      expect(screen.getByTestId('artifacts-empty-filtered')).toBeInTheDocument();
    });
    expect(screen.queryByText('Pentest report')).not.toBeInTheDocument();
  });

  // ── Inline preview pane (A8.5b parity-close) ────────────────────────
  it('renders a SANDBOXED iframe when an html artifact is selected', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        art({
        id: 'art-html',
        type: 'html',
        title: 'Local preview',
        mimeType: 'text/html',
        contentUrl: '/api/artifacts/art-html/content',
      }),
      ]),
    ) as unknown as typeof fetch;

    renderWithProviders(<ArtifactsPage />, { route: '/react/artifacts' });

    await waitFor(() => {
      expect(screen.getByText('Local preview')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('artifact-open-art-html'));
    });

    const frame = await screen.findByTestId('artifact-preview-iframe');
    expect(frame).toHaveAttribute('src', '/api/artifacts/art-html/content');
    // SECURITY: must be sandboxed and must NOT grant allow-same-origin.
    const sandbox = frame.getAttribute('sandbox') || '';
    expect(sandbox).toMatch(/allow-scripts/);
    expect(sandbox).not.toMatch(/allow-same-origin/);
  });

  it('fetches and shows text for a markdown artifact in a <pre>', async () => {
    const body = '# Pentest report\nfindings here';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/content')) {
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        });
      }
      return jsonResponse([
        art({
          id: 'art-md',
          type: 'markdown',
          title: 'Pentest report',
          contentUrl: '/api/artifacts/art-md/content',
        }),
      ]);
    }) as unknown as typeof fetch;

    renderWithProviders(<ArtifactsPage />, { route: '/react/artifacts' });

    await waitFor(() => {
      expect(screen.getByText('Pentest report')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('artifact-open-art-md'));
    });

    const pre = await screen.findByTestId('artifact-preview-text');
    expect(pre).toHaveTextContent('findings here');
    // Footer keeps the open-in-tab + download affordances.
    expect(screen.getByRole('link', { name: /open in new tab/i })).toHaveAttribute(
      'href',
      '/api/artifacts/art-md/content',
    );
  });

  it('renders an <img> for an image artifact', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        art({
          id: 'art-img',
          type: 'other',
          title: 'Graph snapshot',
          mimeType: 'image/png',
          contentUrl: '/api/artifacts/art-img/content',
        }),
      ]),
    ) as unknown as typeof fetch;

    renderWithProviders(<ArtifactsPage />, { route: '/react/artifacts' });

    await waitFor(() => {
      expect(screen.getByText('Graph snapshot')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('artifact-open-art-img'));
    });

    const img = await screen.findByTestId('artifact-preview-image');
    expect(img).toHaveAttribute('src', '/api/artifacts/art-img/content');
  });

  it('shows the error banner on a failed fetch', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'boom' }, 500),
    ) as unknown as typeof fetch;

    renderWithProviders(<ArtifactsPage />, { route: '/react/artifacts' });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load artifacts/);
  });
});
