// Variant mapping for the scope pill — guards against regressions where
// the badge variants drift away from the canonical 3 scope states.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ScopePill } from './ScopePill';

describe('ScopePill', () => {
  it('renders the active label with the completed variant', () => {
    render(<ScopePill status="active" />);
    const pill = screen.getByText('active');
    expect(pill).toBeInTheDocument();
    // The badge variant is encoded in the class list — we sniff for the
    // distinctive completed-variant color token rather than re-asserting
    // every class, which would be brittle.
    expect(pill.className).toMatch(/#66c293/);
  });

  it('renders the expired label with the failed variant', () => {
    render(<ScopePill status="expired" />);
    const pill = screen.getByText('expired');
    expect(pill).toBeInTheDocument();
    expect(pill.className).toMatch(/destructive/);
  });

  it('renders the archived label with the canceled variant', () => {
    render(<ScopePill status="archived" />);
    const pill = screen.getByText('archived');
    expect(pill).toBeInTheDocument();
    // canceled variant uses the fg-3 token; the kit's `text-[var(--fg-3)]`
    // class will appear in the className string.
    expect(pill.className).toMatch(/--fg-3/);
  });

  it('passes through an extra className when supplied', () => {
    render(<ScopePill status="active" className="extra-class" />);
    expect(screen.getByText('active').className).toContain('extra-class');
  });
});
