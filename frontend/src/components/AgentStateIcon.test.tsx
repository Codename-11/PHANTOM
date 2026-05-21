// AgentStateIcon — verifies each ported state renders its `.psas`-scoped
// SVG with the right `.anim-*` class + size, and that VerifiedIcon arms
// the once-only `.play` animation and re-arms when `play` flips true.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import {
  LoadingIcon,
  ScanningIcon,
  EngagingIcon,
  VerifiedIcon,
} from './AgentStateIcon';

describe('AgentStateIcon', () => {
  it('LoadingIcon renders the loading SVG inside a .psas scope at the given size', () => {
    const { container } = render(<LoadingIcon size={40} />);
    expect(container.querySelector('.psas')).toBeInTheDocument();
    const svg = container.querySelector('svg.anim-loading');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '40');
    expect(svg).toHaveAttribute('height', '40');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    // Three sequenced iso tiles.
    expect(container.querySelectorAll('.ld-tile')).toHaveLength(3);
  });

  it('ScanningIcon renders the rotating beam + 3x3 host node grid', () => {
    const { container } = render(<ScanningIcon size={24} />);
    expect(container.querySelector('svg.anim-scanning')).toBeInTheDocument();
    expect(container.querySelector('.sc-beam')).toBeInTheDocument();
    expect(container.querySelectorAll('.sc-node')).toHaveLength(9);
  });

  it('EngagingIcon renders the policy frame, packet train, and tumblers', () => {
    const { container } = render(<EngagingIcon size={24} />);
    expect(container.querySelector('svg.anim-engaging')).toBeInTheDocument();
    expect(container.querySelector('.en-policy')).toBeInTheDocument();
    expect(container.querySelectorAll('.en-packet')).toHaveLength(3);
    expect(container.querySelectorAll('.en-bar')).toHaveLength(3);
  });

  it('VerifiedIcon renders the ghost cube + check and arms .play by default', () => {
    const { container } = render(<VerifiedIcon size={24} />);
    const svg = container.querySelector('svg.anim-verified');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('play');
    expect(container.querySelector('.vf-check')).toBeInTheDocument();
    expect(container.querySelector('.vf-ring')).toBeInTheDocument();
    expect(container.querySelector('.vf-cube')).toBeInTheDocument();
  });

  it('VerifiedIcon drops .play when play=false', () => {
    const { container } = render(<VerifiedIcon size={24} play={false} />);
    const svg = container.querySelector('svg.anim-verified');
    expect(svg).toBeInTheDocument();
    expect(svg).not.toHaveClass('play');
  });

  it('VerifiedIcon re-arms .play when play flips false → true', () => {
    const { container, rerender } = render(<VerifiedIcon size={24} play={false} />);
    expect(container.querySelector('svg.anim-verified')).not.toHaveClass('play');
    rerender(<VerifiedIcon size={24} play />);
    expect(container.querySelector('svg.anim-verified')).toHaveClass('play');
  });
});
