// Onboarding page — checklist renders all five steps and the load-demo
// mutation fires the right POST.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import OnboardingPage from './Onboarding';
import type { OnboardingChecklist } from '@/lib/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FRESH: OnboardingChecklist = {
  complete: false,
  checklist: {
    demoLoaded: false,
    toolpacksInstalled: false,
    hasScope: false,
    hasAsset: false,
    hasRun: false,
  },
};

const PARTIAL: OnboardingChecklist = {
  complete: false,
  checklist: {
    demoLoaded: true,
    toolpacksInstalled: true,
    hasScope: false,
    hasAsset: false,
    hasRun: false,
  },
};

describe('OnboardingPage', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the five checklist rows from /api/onboarding/checklist', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(FRESH)) as unknown as typeof fetch;
    renderWithProviders(<OnboardingPage />, { route: '/react/onboarding' });

    await waitFor(() => {
      expect(screen.getByTestId('onb-checklist')).toBeInTheDocument();
    });
    // 5 rows, all unchecked.
    expect(screen.getByTestId('onb-row-demoLoaded')).toBeInTheDocument();
    expect(screen.getByTestId('onb-row-toolpacksInstalled')).toBeInTheDocument();
    expect(screen.getByTestId('onb-row-hasScope')).toBeInTheDocument();
    expect(screen.getByTestId('onb-row-hasAsset')).toBeInTheDocument();
    expect(screen.getByTestId('onb-row-hasRun')).toBeInTheDocument();
    expect(screen.getAllByTestId('onb-item-pending').length).toBe(5);
  });

  it('flips checked status icons for completed items', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(PARTIAL)) as unknown as typeof fetch;
    renderWithProviders(<OnboardingPage />, { route: '/react/onboarding' });

    await waitFor(() => {
      expect(screen.getByTestId('onb-checklist')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('onb-item-done').length).toBe(2);
    expect(screen.getAllByTestId('onb-item-pending').length).toBe(3);
    expect(screen.getByText(/3 steps left/)).toBeInTheDocument();
  });

  it('renders Load demo + Clear demo buttons', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(FRESH)) as unknown as typeof fetch;
    renderWithProviders(<OnboardingPage />, { route: '/react/onboarding' });
    await waitFor(() => {
      expect(screen.getByTestId('load-demo-btn')).toBeInTheDocument();
    });
    expect(screen.getByTestId('clear-demo-btn')).toBeInTheDocument();
  });

  it('clicking Load demo POSTs to /api/onboarding/load-demo', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/onboarding/checklist')) return jsonResponse(FRESH);
      if (url.endsWith('/api/onboarding/load-demo')) {
        // Capture the call for assertion below.
        (fetchMock as unknown as { _last?: { url: string; method?: string; body?: BodyInit | null } })._last = {
          url, method: init?.method, body: init?.body ?? null,
        };
        return jsonResponse({ ok: true, scopeCount: 1 });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    renderWithProviders(<OnboardingPage />, { route: '/react/onboarding' });
    await waitFor(() => {
      expect(screen.getByTestId('load-demo-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('load-demo-btn'));

    await waitFor(() => {
      const last = (fetchMock as unknown as { _last?: { url: string; method?: string } })._last;
      expect(last?.url).toMatch(/\/api\/onboarding\/load-demo$/);
      expect(last?.method).toBe('POST');
    });
  });
});
