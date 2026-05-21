// Smoke tests for the packet-train logomark — confirms the SVG renders,
// scales via the `size` prop, and only emits the animation <style> +
// scan/verify packets when `animated` is set (the sidebar mark must stay
// static).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { PhantomMark } from './PhantomMark';

describe('PhantomMark', () => {
  it('renders an accessible svg with the brand label', () => {
    const { getByRole } = render(<PhantomMark />);
    const svg = getByRole('img', { name: 'PHANTOM SEC' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('honors the size prop on width/height', () => {
    const { getByRole } = render(<PhantomMark size={48} />);
    const svg = getByRole('img');
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');
  });

  it('is static by default — no animation keyframes injected', () => {
    const { container } = render(<PhantomMark />);
    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('.pkt')).toBeNull();
  });

  it('emits packet-train animation pieces when animated', () => {
    const { container } = render(<PhantomMark animated />);
    expect(container.querySelector('style')).not.toBeNull();
    expect(container.querySelectorAll('.pkt')).toHaveLength(3);
    expect(container.querySelector('.scan')).not.toBeNull();
    expect(container.querySelector('.verify')).not.toBeNull();
  });

  it('uses cyan + fg tokens, not hard-coded hex, for the frame', () => {
    const { container } = render(<PhantomMark />);
    const rect = container.querySelector('rect');
    expect(rect?.getAttribute('stroke')).toBe('var(--cy-1)');
  });
});
