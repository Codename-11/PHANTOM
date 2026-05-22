// Registry list + inline detail column (SplitPane) — behind a stubbed
// fetch routed by URL. Covers: list render, detail column open, trust pill
// (signed vs unsigned), and the rendered-but-disabled Request-install button.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import RegistryPage from './Registry';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// A signed manifest: declared digest === computed digest.
const SIGNED_DIGEST = 'sha256:aaa';
// An unsigned manifest: declared !== computed (mismatch).
const SIGNED_ID = 'pack-signed';
const UNSIGNED_ID = 'pack-unsigned';

const LIST_PAYLOAD = {
  summary: { total: 2, valid: 2, invalid: 0 },
  manifests: [
    {
      id: SIGNED_ID,
      version: '1.0.0',
      valid: true,
      errorCount: 0,
      source: 'fixture',
      digest: SIGNED_DIGEST,
      computedDigest: SIGNED_DIGEST,
      identity: { id: SIGNED_ID, name: 'Signed Pack', summary: 'A trusted toolpack.' },
      risk: { action_classes: ['recon', 'network-scan'] },
    },
    {
      id: UNSIGNED_ID,
      version: '0.2.0',
      valid: true,
      errorCount: 0,
      source: 'fixture',
      digest: 'sha256:declared',
      computedDigest: 'sha256:ondisk',
      identity: { id: UNSIGNED_ID, name: 'Unsigned Pack', summary: 'Digest mismatch.' },
      risk: { action_classes: [] },
    },
  ],
};

const SIGNED_RECORD = {
  id: SIGNED_ID,
  version: '1.0.0',
  valid: true,
  errors: [],
  digest: SIGNED_DIGEST,
  computedDigest: SIGNED_DIGEST,
  source: 'fixture',
  manifest: {
    identity: { id: SIGNED_ID, name: 'Signed Pack', summary: 'A trusted toolpack.', version: '1.0.0' },
    risk: { action_classes: ['recon'] },
    tools: [{ name: 'scan', risk: 'low', gated: false }],
    install: { recipes: [{ kind: 'npm', spec: 'foo' }] },
    trust: { digest: SIGNED_DIGEST, signed_by: 'phantom-root' },
    lifecycle: {},
  },
};

const PREVIEW_PAYLOAD = {
  id: SIGNED_ID,
  version: '1.0.0',
  plan: { recipes: [{ kind: 'npm', spec: 'foo' }], privileges: [], rollback: null },
  toolCount: 1,
  riskClasses: ['recon'],
  digest: SIGNED_DIGEST,
  note: 'Preview only — no execution. Operator approval still required (Approvals queue).',
};

// Routes a fetch call to the right canned payload by URL/method.
function makeFetch(): typeof fetch {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    if (url.endsWith('/preview-install')) return jsonResponse(PREVIEW_PAYLOAD);
    if (url.includes(`/api/registry/local/${SIGNED_ID}`) && init?.method !== 'POST') {
      return jsonResponse(SIGNED_RECORD);
    }
    if (url.endsWith('/api/registry/local')) return jsonResponse(LIST_PAYLOAD);
    return jsonResponse({ error: 'not found' }, 404);
  }) as unknown as typeof fetch;
}

describe('RegistryPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders a row per manifest with validity + trust pills', async () => {
    globalThis.fetch = makeFetch();
    renderWithProviders(<RegistryPage />, { route: '/react/registry' });

    expect(screen.getByRole('heading', { level: 1, name: /Registry/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Signed Pack')).toBeInTheDocument();
    });
    expect(screen.getByText('Unsigned Pack')).toBeInTheDocument();

    // Signed pack → trust ✓; unsigned pack → unsigned (list-row level).
    const signed = screen.getAllByText('trust ✓');
    expect(signed.length).toBeGreaterThan(0);
    const unsigned = screen.getAllByText('unsigned');
    expect(unsigned.length).toBeGreaterThan(0);
    // Summary line surfaces totals.
    expect(screen.getByTestId('registry-summary')).toHaveTextContent('total 2');
  });

  it('shows the empty state when no manifests exist', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ summary: { total: 0, valid: 0, invalid: 0 }, manifests: [] }),
    ) as unknown as typeof fetch;

    renderWithProviders(<RegistryPage />, { route: '/react/registry' });

    await waitFor(() => {
      expect(screen.getByTestId('registry-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/No manifests found/i)).toBeInTheDocument();
  });

  it('opens the inline detail column on row click with a signed trust pill', async () => {
    globalThis.fetch = makeFetch();
    renderWithProviders(<RegistryPage />, { route: '/react/registry' });

    await waitFor(() => screen.getByText('Signed Pack'));
    fireEvent.click(screen.getByRole('button', { name: /Open Signed Pack/i }));

    // Wait for the record to load into the Sheet (skeleton → content).
    await waitFor(() => {
      expect(screen.getByText('phantom-root')).toBeInTheDocument();
    });
    const sheet = screen.getByTestId('registry-detail-sheet');
    expect(sheet).toHaveTextContent('Signed Pack');
    // Signed trust pill present in the header (declared === computed).
    expect(sheet.querySelector('[data-trust="signed"]')).not.toBeNull();
    expect(sheet).toHaveTextContent('Tools (1)');
  });

  it('derives an unsigned trust pill when declared != computed digest', async () => {
    globalThis.fetch = makeFetch();
    renderWithProviders(<RegistryPage />, { route: '/react/registry' });

    await waitFor(() => screen.getByText('Unsigned Pack'));
    // The unsigned row carries the unsigned trust marker.
    const row = screen.getByRole('button', { name: /Open Unsigned Pack/i });
    expect(row.querySelector('[data-trust="unsigned"]')).not.toBeNull();
    expect(row.querySelector('[data-trust="signed"]')).toBeNull();
  });

  it('renders the preview-install plan with a disabled Request-install button', async () => {
    globalThis.fetch = makeFetch();
    renderWithProviders(<RegistryPage />, { route: '/react/registry' });

    await waitFor(() => screen.getByText('Signed Pack'));
    fireEvent.click(screen.getByRole('button', { name: /Open Signed Pack/i }));

    await waitFor(() => {
      expect(screen.getByText(/Preview install plan/i)).toBeInTheDocument();
    });
    const btn = screen.getByRole('button', { name: /Request install/i });
    expect(btn).toBeDisabled();
  });
});
