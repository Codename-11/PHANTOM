// ScopeStrip — topbar active-scope chip + selector. Verifies the muted
// "no scope" affordance, that picking a scope from the dialog updates the
// chip + persists the id, and that Clear resets the selection.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import { useActiveScopeStore } from '@/lib/activeScope';
import { ScopeStrip } from './ScopeStrip';

const SCOPES = [
  {
    id: 'scope-a',
    name: 'Acme External',
    targets: { hosts: ['a.example', 'b.example'], domains: ['acme.test'] },
    allowed_actions: [],
    blocked_actions: [],
    action_modes: null,
    active_hours: null,
    blackout_windows: null,
    rate_caps: null,
    rules_of_engagement: '',
    credential_refs: [],
    notes: '',
    expires_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
    archived_at: null,
  },
  {
    id: 'scope-b',
    name: 'Lab Internal',
    targets: { cidrs: ['10.0.0.0/24'] },
    allowed_actions: [],
    blocked_actions: [],
    action_modes: null,
    active_hours: null,
    blackout_windows: null,
    rate_caps: null,
    rules_of_engagement: '',
    credential_refs: [],
    notes: '',
    expires_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
    archived_at: null,
  },
];

function scopesJson(): Response {
  return new Response(JSON.stringify(SCOPES), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ScopeStrip', () => {
  beforeEach(() => {
    localStorage.clear();
    useActiveScopeStore.setState({ activeScopeId: null });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(scopesJson());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useActiveScopeStore.setState({ activeScopeId: null });
    localStorage.clear();
  });

  it('shows the muted "No scope selected" affordance when none is active', () => {
    renderWithProviders(<ScopeStrip />);
    const strip = screen.getByTestId('scope-strip');
    expect(strip.textContent).toContain('No scope selected');
  });

  it('selecting a scope updates the chip and persists the id', async () => {
    renderWithProviders(<ScopeStrip />);
    fireEvent.click(screen.getByTestId('scope-strip'));

    // Dialog lists the live scopes.
    const option = await screen.findByText('Acme External');
    fireEvent.click(option);

    await waitFor(() => {
      expect(screen.getByTestId('scope-strip').textContent).toContain('Acme External');
    });
    expect(screen.getByTestId('scope-strip').textContent).toContain('SCOPE');
    // Persisted to the store + localStorage.
    expect(useActiveScopeStore.getState().activeScopeId).toBe('scope-a');
    expect(localStorage.getItem('phantom-active-scope')).toBe('scope-a');
  });

  it('Clear resets the active scope', async () => {
    useActiveScopeStore.setState({ activeScopeId: 'scope-a' });
    renderWithProviders(<ScopeStrip />);
    fireEvent.click(screen.getByTestId('scope-strip'));

    const clear = await screen.findByTestId('scope-strip-clear');
    fireEvent.click(clear);

    await waitFor(() => {
      expect(screen.getByTestId('scope-strip').textContent).toContain('No scope selected');
    });
    expect(useActiveScopeStore.getState().activeScopeId).toBeNull();
    expect(localStorage.getItem('phantom-active-scope')).toBeNull();
  });
});
