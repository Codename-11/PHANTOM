// ToolpackPicker — multi-select toggle, empty state, risk-label rendering.
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import { ToolpackPicker } from './ToolpackPicker';

describe('ToolpackPicker', () => {
  const sample = [
    { id: 'web-recon', name: 'Web recon', risks: ['recon'] },
    { id: 'reporting', name: 'Reporting', risks: ['read/local'] },
  ];

  it('renders the empty state when no toolpacks available', () => {
    renderWithProviders(
      <ToolpackPicker options={[]} selected={[]} onChange={() => {}} />,
    );
    expect(screen.getByTestId('toolpack-picker-empty')).toBeInTheDocument();
    expect(screen.getByText(/No toolpacks available/i)).toBeInTheDocument();
  });

  it('renders one chip per option with the name as label', () => {
    renderWithProviders(
      <ToolpackPicker options={sample} selected={[]} onChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Web recon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reporting' })).toBeInTheDocument();
  });

  it('clicking a chip emits onChange with the new selected list', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ToolpackPicker options={sample} selected={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Web recon' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual(['web-recon']);
  });

  it('clicking an already-selected chip toggles it off', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ToolpackPicker options={sample} selected={['web-recon']} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Web recon' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    // After toggling off, the new list omits 'web-recon'.
    expect(onChange.mock.calls[0]?.[0]).not.toContain('web-recon');
  });

  it('multi-select: selecting a second chip yields both ids', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ToolpackPicker
        options={sample}
        selected={['web-recon']}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reporting' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as string[];
    expect(next).toEqual(expect.arrayContaining(['web-recon', 'reporting']));
  });

  it('selected chips render with the on state', () => {
    renderWithProviders(
      <ToolpackPicker options={sample} selected={['web-recon']} onChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Web recon' }))
      .toHaveAttribute('data-state', 'on');
    expect(screen.getByRole('button', { name: 'Reporting' }))
      .toHaveAttribute('data-state', 'off');
  });
});
