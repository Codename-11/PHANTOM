// Variant mapping for the run-status pill. The legacy CSS used a
// distinct color per status; the React badge variants reuse the
// existing campaign-pill palette so we guard against drift.
//
// The pill also renders an inline agent-state animation for the
// running / completed statuses (ScanningIcon / VerifiedIcon). The label
// text is wrapped alongside the icon, so the variant-color assertions
// target the Badge element (the `.badge`-class ancestor) rather than the
// text node itself.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RunPill } from './RunPill';

// The label text now lives inside a flex wrapper next to the (optional)
// icon. Walk up to the Badge element that carries the variant tokens.
// The Badge renders cva utility classes (no literal `.badge`), but every
// variant shares the `rounded-full` base class — anchor on that.
function badgeFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('.rounded-full');
  if (!el) throw new Error(`no Badge ancestor for "${label}"`);
  return el as HTMLElement;
}

describe('RunPill', () => {
  it('renders the running label with the running variant color', () => {
    render(<RunPill status="running" />);
    const label = screen.getByText('running');
    expect(label).toBeInTheDocument();
    // running badge uses the cyan accent token; sniff for it on the badge.
    expect(badgeFor('running').className).toMatch(/--cy-1/);
  });

  it('renders the completed label with the completed variant color', () => {
    render(<RunPill status="completed" />);
    const label = screen.getByText('completed');
    expect(label).toBeInTheDocument();
    // completed badge uses the muted-ok token (--ok-2) in the cva map.
    expect(badgeFor('completed').className).toMatch(/--ok-2/);
  });

  it('renders the failed label with the destructive variant', () => {
    render(<RunPill status="failed" />);
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(badgeFor('failed').className).toMatch(/destructive/);
  });

  it('maps stopped onto the canceled variant', () => {
    render(<RunPill status="stopped" />);
    expect(screen.getByText('stopped')).toBeInTheDocument();
    // canceled badge uses fg-3 token.
    expect(badgeFor('stopped').className).toMatch(/--fg-3/);
  });

  it('falls back to the draft variant for unknown statuses', () => {
    render(<RunPill status="weird" />);
    expect(screen.getByText('weird')).toBeInTheDocument();
    // draft variant uses fg-3 and bg-3 tokens.
    expect(badgeFor('weird').className).toMatch(/--fg-3/);
  });

  it('passes through an extra className when supplied', () => {
    render(<RunPill status="running" className="extra-class" />);
    expect(badgeFor('running').className).toContain('extra-class');
  });

  it('renders the scanning agent-state icon for running runs', () => {
    const { container } = render(<RunPill status="running" />);
    expect(container.querySelector('[data-state="scanning"]')).toBeInTheDocument();
  });

  it('renders the verified agent-state icon for completed runs', () => {
    const { container } = render(<RunPill status="completed" />);
    expect(container.querySelector('[data-state="verified"]')).toBeInTheDocument();
  });

  it('renders no agent-state icon for terminal/idle statuses', () => {
    const { container } = render(<RunPill status="stopped" />);
    expect(container.querySelector('[data-state]')).not.toBeInTheDocument();
  });
});
