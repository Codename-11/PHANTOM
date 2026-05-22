// CommandPalette — ⌘K palette. Verifies that with the store open the modal
// renders the Navigation group, a typed query filters the visible results,
// and selecting a result navigates the router + closes the palette.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import { useCommandPalette } from '@/lib/commandStore';
import { CommandPalette } from './CommandPalette';

// Capture router navigation without standing up real routes.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => navigateSpy };
});

// Keep the lazy data queries quiet — empty arrays, so only the static
// Navigation + Actions groups render. (We assert on Navigation.)
function emptyJson(): Response {
  return new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    navigateSpy.mockReset();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(emptyJson());
    // Start each test with the palette open.
    useCommandPalette.setState({ open: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useCommandPalette.setState({ open: false });
  });

  it('renders the dialog with Navigation results when open', () => {
    renderWithProviders(<CommandPalette />);
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeTruthy();
    expect(screen.getByText('Navigation')).toBeTruthy();
    expect(screen.getByText('Dash')).toBeTruthy();
    expect(screen.getByText('Alerts')).toBeTruthy();
  });

  it('filters Navigation results by the typed query', async () => {
    renderWithProviders(<CommandPalette />);
    const input = screen.getByLabelText('Search commands') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'runs' } });

    await waitFor(() => {
      expect(screen.getByText('Runs')).toBeTruthy();
    });
    // A non-matching nav entry should be filtered out.
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('navigates and closes when a result is clicked', () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.click(screen.getByText('Alerts'));
    expect(navigateSpy).toHaveBeenCalledWith('/alerts');
    expect(useCommandPalette.getState().open).toBe(false);
  });

  it('navigates the active item on Enter (keyboard nav)', () => {
    renderWithProviders(<CommandPalette />);
    const input = screen.getByLabelText('Search commands') as HTMLInputElement;
    // Narrow to a single nav row so the first/active item is deterministic.
    fireEvent.change(input, { target: { value: 'graph' } });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(navigateSpy).toHaveBeenCalledWith('/graph');
    expect(useCommandPalette.getState().open).toBe(false);
  });

  it('toggles open state via ⌘K / Ctrl+K', () => {
    useCommandPalette.setState({ open: false });
    renderWithProviders(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(useCommandPalette.getState().open).toBe(true);
  });
});
