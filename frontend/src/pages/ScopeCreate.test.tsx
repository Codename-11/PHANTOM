// Scope create — form validation: name required, targets parse correctly,
// blocked-actions locked. We exercise validateScopeForm directly for the
// pure-logic asserts and drive the form mount for the DOM-level locks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import ScopeCreateRoute, {
  defaultScopeFormState,
  validateScopeForm,
} from './ScopeCreate';
import { SCOPE_BLOCKED_ACTIONS } from '@/lib/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('validateScopeForm', () => {
  it('flags missing name', () => {
    const v = validateScopeForm(defaultScopeFormState());
    expect(v.ok).toBe(false);
    expect(v.errors.name).toMatch(/required/i);
  });

  it('passes when name is supplied', () => {
    const v = validateScopeForm({ ...defaultScopeFormState(), name: 'LAB' });
    expect(v.ok).toBe(true);
    expect(v.errors.name).toBeUndefined();
  });

  it('treats whitespace-only name as missing', () => {
    const v = validateScopeForm({ ...defaultScopeFormState(), name: '   ' });
    expect(v.ok).toBe(false);
    expect(v.errors.name).toMatch(/required/i);
  });
});

describe('ScopeCreateRoute', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the four locked blocked-action checkboxes (disabled + checked)', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    renderWithProviders(<ScopeCreateRoute />, { route: '/react/scope/new' });

    await waitFor(() => {
      expect(screen.getByTestId('scope-create-form')).toBeInTheDocument();
    });

    for (const action of SCOPE_BLOCKED_ACTIONS) {
      const row = screen.getByTestId(`scope-blocked-${action}`);
      expect(row).toBeInTheDocument();
      expect(row).toHaveAttribute('data-disabled', 'true');
      expect(row).toHaveAttribute('data-checked', 'true');
      const checkbox = row.querySelector('button[role="checkbox"]') as HTMLButtonElement | null;
      expect(checkbox).not.toBeNull();
      expect(checkbox!.getAttribute('aria-checked')).toBe('true');
      expect(checkbox!.disabled).toBe(true);
    }
  });

  it('surfaces the required-name error when the user submits an empty form', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    renderWithProviders(<ScopeCreateRoute />, { route: '/react/scope/new' });

    await waitFor(() => {
      expect(screen.getByTestId('scope-create-submit')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('scope-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('scope-name-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('scope-name-error')).toHaveTextContent(/required/i);
    expect(screen.getByTestId('scope-create-feedback')).toHaveTextContent(/required/i);
  });

  it('parses targets via /api/scopes/parse-targets on blur', async () => {
    let parseCalled = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/scopes/parse-targets') && init?.method === 'POST') {
        parseCalled++;
        return jsonResponse({
          targets: [
            { id: 'host:lab.test', type: 'host', value: 'lab.test' },
            { id: 'cidr:10.0.0.0/24', type: 'cidr', value: '10.0.0.0/24' },
          ],
          errors: [],
          scopeFields: { hosts: ['lab.test'], cidrs: ['10.0.0.0/24'], domains: [], urls: [] },
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(<ScopeCreateRoute />, { route: '/react/scope/new' });

    await waitFor(() => {
      expect(screen.getByTestId('scope-targets-input')).toBeInTheDocument();
    });
    const ta = screen.getByTestId('scope-targets-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'lab.test 10.0.0.0/24' } });
    fireEvent.blur(ta);

    await waitFor(() => {
      expect(parseCalled).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId('scope-parsed-targets')).toBeInTheDocument();
    });
    expect(screen.getByText('host:lab.test')).toBeInTheDocument();
    expect(screen.getByText('cidr:10.0.0.0/24')).toBeInTheDocument();
  });

  it('POSTs /api/scopes with the canonical blocked-action set when submitting', async () => {
    let createBody: unknown = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/scopes' && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body));
        return jsonResponse({
          id: 'created-1',
          name: 'LAB',
          targets: {},
          allowed_actions: ['recon'],
          blocked_actions: Array.from(SCOPE_BLOCKED_ACTIONS),
          action_modes: null,
          active_hours: null,
          blackout_windows: null,
          rate_caps: null,
          rules_of_engagement: '',
          credential_refs: [],
          notes: '',
          expires_at: null,
          created_at: new Date().toISOString(),
          updated_at: null,
          archived_at: null,
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderWithProviders(<ScopeCreateRoute />, { route: '/react/scope/new' });

    await waitFor(() => {
      expect(screen.getByTestId('scope-name-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('scope-name-input'), {
      target: { value: 'LAB' },
    });

    fireEvent.click(screen.getByTestId('scope-create-submit'));

    await waitFor(() => {
      expect(createBody).not.toBeNull();
    });
    const body = createBody as {
      name: string;
      allowedActions: string[];
      blockedActions: string[];
    };
    expect(body.name).toBe('LAB');
    // Blocked actions are pinned to the canonical 4 even though the
    // checkboxes are inert in the UI.
    expect(new Set(body.blockedActions)).toEqual(
      new Set(SCOPE_BLOCKED_ACTIONS),
    );
    // Default allowed set seeded by defaultScopeFormState.
    expect(body.allowedActions).toContain('recon');
  });
});
