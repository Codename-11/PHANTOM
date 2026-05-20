// RiskGrid — exploit + destructive locked, others toggle through onChange.
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import { RiskGrid } from './RiskGrid';

describe('RiskGrid', () => {
  it('exploit + destructive are disabled (locked · deny)', () => {
    renderWithProviders(
      <RiskGrid allowed={['read/local', 'recon']} onChange={() => {}} />,
    );
    const exploitRow = screen
      .getByRole('checkbox', { name: 'Exploit' });
    expect(exploitRow).toBeDisabled();
    const destructiveRow = screen
      .getByRole('checkbox', { name: 'Destructive' });
    expect(destructiveRow).toBeDisabled();
    // 'locked · deny' tag appears in their rows.
    expect(screen.getAllByText(/locked · deny/i).length).toBeGreaterThanOrEqual(2);
  });

  it('warning classes flag approval-only', () => {
    renderWithProviders(
      <RiskGrid allowed={[]} onChange={() => {}} />,
    );
    // 'Credentialed' + 'Online brute force' both render the approval-only flag.
    expect(screen.getAllByText(/approval-only/i).length).toBeGreaterThanOrEqual(2);
  });

  it('toggling an unlocked class emits onChange with the new list', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <RiskGrid allowed={['read/local']} onChange={onChange} />,
    );
    const recon = screen.getByRole('checkbox', { name: 'Recon' });
    fireEvent.click(recon);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as string[];
    expect(next).toContain('recon');
    expect(next).toContain('read/local');
  });

  it('clicking a locked class is a no-op', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <RiskGrid allowed={[]} onChange={onChange} />,
    );
    const exploit = screen.getByRole('checkbox', { name: 'Exploit' });
    fireEvent.click(exploit);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('checked classes render with the allowed style attribute', () => {
    renderWithProviders(
      <RiskGrid allowed={['recon']} onChange={() => {}} />,
    );
    const reconCheckbox = screen.getByRole('checkbox', { name: 'Recon' });
    expect(reconCheckbox).toHaveAttribute('data-state', 'checked');
  });
});
