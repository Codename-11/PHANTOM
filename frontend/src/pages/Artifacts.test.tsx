// ArtifactsPage — list renders + filter chip restricts visible rows.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';

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
    // Run id link points at the detail route on /react/runs/:id.
    const runLinks = screen.getAllByRole('link', { name: /run-aaaa/i });
    expect(runLinks[0]).toHaveAttribute('href', '/react/runs/run-aaaa1111');
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
    const chip = screen.getByRole('button', { name: /Evidence/i });
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
    const otherChip = screen.getByRole('button', { name: /Other/i });
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
