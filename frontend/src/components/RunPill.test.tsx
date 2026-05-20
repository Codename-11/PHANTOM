// Variant mapping for the run-status pill. The legacy CSS used a
// distinct color per status; the React badge variants reuse the
// existing campaign-pill palette so we guard against drift.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RunPill } from './RunPill';

describe('RunPill', () => {
  it('renders the running label with the running variant color', () => {
    render(<RunPill status="running" />);
    const pill = screen.getByText('running');
    expect(pill).toBeInTheDocument();
    // running badge uses the cyan accent token; sniff for it.
    expect(pill.className).toMatch(/--cy-1/);
  });

  it('renders the completed label with the completed variant color', () => {
    render(<RunPill status="completed" />);
    const pill = screen.getByText('completed');
    expect(pill).toBeInTheDocument();
    // completed badge uses #66c293 (green) in the cva map.
    expect(pill.className).toMatch(/#66c293/);
  });

  it('renders the failed label with the destructive variant', () => {
    render(<RunPill status="failed" />);
    const pill = screen.getByText('failed');
    expect(pill).toBeInTheDocument();
    expect(pill.className).toMatch(/destructive/);
  });

  it('maps stopped onto the canceled variant', () => {
    render(<RunPill status="stopped" />);
    const pill = screen.getByText('stopped');
    expect(pill).toBeInTheDocument();
    // canceled badge uses fg-3 token.
    expect(pill.className).toMatch(/--fg-3/);
  });

  it('falls back to the draft variant for unknown statuses', () => {
    render(<RunPill status="weird" />);
    const pill = screen.getByText('weird');
    expect(pill).toBeInTheDocument();
    // draft variant uses fg-3 and bg-3 tokens.
    expect(pill.className).toMatch(/--fg-3/);
  });

  it('passes through an extra className when supplied', () => {
    render(<RunPill status="running" className="extra-class" />);
    expect(screen.getByText('running').className).toContain('extra-class');
  });
});
