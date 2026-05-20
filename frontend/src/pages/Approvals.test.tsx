// Approvals page — list renders, detail drawer surfaces the EXPLAINED
// fields, denial of a high|crit approval requires a note before
// submission.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { makeQueryClient } from '@/test/test-utils';
import ApprovalsPage, { ApprovalDetailRoute } from './Approvals';
import type { ApprovalRecord, InstallRequestsResponse } from '@/lib/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const explained: ApprovalRecord[] = [
  {
    id: 'req-1',
    type: 'install',
    target: 'packages:nmap',
    riskClass: 'credentialed',
    actionClass: 'install.apt',
    policyReason: 'Installing 1 security tool via apt requires elevated privileges and explicit operator approval.',
    expectedEffect: 'Installs 1 security tool via apt.',
    sideEffects: [
      'Invokes apt as the package manager.',
      'Requires elevated privileges (sudo / admin).',
    ],
    rawDetails: { plan: [{ backend: 'apt', command: 'nmap' }] },
    createdAt: '2026-05-20T12:00:00Z',
    status: 'pending',
    denialReason: null,
  },
];

const RESP: InstallRequestsResponse = {
  requests: [
    {
      id: 'req-1',
      status: 'pending',
      toolIds: ['nmap'],
      plan: [{ id: 'nmap', backend: 'apt', command: 'apt', args: ['install', 'nmap'] }],
      requested_at: '2026-05-20T12:00:00Z',
    },
  ],
  explained,
};

function stubFetch(map: Record<string, unknown> = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/installer/requests')) {
      if (url.includes('/approve')) return jsonResponse(map.approve ?? { ok: true });
      if (url.includes('/cancel')) {
        if (map.denyError) return jsonResponse(map.denyError, 400);
        return jsonResponse(map.deny ?? { ok: true });
      }
      return jsonResponse(map.pending ?? RESP);
    }
    if (url.includes('/api/approvals')) {
      return jsonResponse(map.history ?? { count: 0, events: [], explained: [] });
    }
    // Capture POST bodies for assertion.
    if (init?.method === 'POST') {
      (globalThis.fetch as unknown as { _last?: unknown })._last = { url, init };
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

describe('ApprovalsPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function renderWithRoute(initial: string, qc: QueryClient = makeQueryClient()) {
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/react/approvals" element={<ApprovalsPage />}>
              <Route path=":id" element={<ApprovalDetailRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders the pending approvals list', async () => {
    stubFetch();
    renderWithRoute('/react/approvals');
    await waitFor(() => {
      expect(screen.getByTestId('approvals-list')).toBeInTheDocument();
    });
    expect(screen.getByText('packages:nmap')).toBeInTheDocument();
    // The risk + action chips render in UPPERCASE.
    expect(screen.getByText(/CREDENTIALED/)).toBeInTheDocument();
  });

  it('renders the empty state when there are no pending approvals', async () => {
    stubFetch({ pending: { requests: [], explained: [] } });
    renderWithRoute('/react/approvals');
    await waitFor(() => {
      expect(screen.getByTestId('approvals-empty')).toBeInTheDocument();
    });
  });

  it('opens the detail Sheet at /react/approvals/:id with structured fields', async () => {
    stubFetch();
    renderWithRoute('/react/approvals/req-1');
    // Wait for the data-driven raw-json section to render — this is
    // the last piece to mount once the bundle query resolves.
    const raw = await screen.findByTestId('approval-raw-json', {}, { timeout: 3000 });
    expect(raw).toBeInTheDocument();
    // ACTION / REASON / EFFECT rows present (use getAllByText because
    // both the list row + detail Sheet render the same approval).
    expect(screen.getAllByText(/install\.apt/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/requires elevated privileges/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Installs 1 security tool via apt/).length).toBeGreaterThan(0);
  });

  it('requires a denial note before submitting deny for high|crit approval', async () => {
    stubFetch();
    renderWithRoute('/react/approvals/req-1');
    const denyBtn = await screen.findByTestId('approval-deny-btn', {}, { timeout: 3000 });
    fireEvent.click(denyBtn);
    await waitFor(() => {
      expect(screen.getByTestId('deny-dialog')).toBeInTheDocument();
    });
    // Confirm is disabled while the textarea is empty.
    expect(screen.getByTestId('deny-confirm-btn')).toBeDisabled();
    // After typing a note, the button enables.
    fireEvent.change(screen.getByTestId('deny-note-input'), {
      target: { value: 'No business need.' },
    });
    expect(screen.getByTestId('deny-confirm-btn')).toBeEnabled();
  });
});
