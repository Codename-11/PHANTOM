// Vitest setup — wire jest-dom matchers (`toBeInTheDocument`, etc.) and
// install a couple of jsdom shims Radix relies on. Loaded via
// vite.config.react.ts `test.setupFiles`.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Auto-cleanup between tests. testing-library's afterEach is only
// auto-registered when `globals: true` in vitest; we keep globals off
// to avoid polluting the module scope, so we wire cleanup manually.
afterEach(() => {
  cleanup();
});

// Radix's primitives use ResizeObserver / DOMRect / hasPointerCapture in
// jsdom, none of which jsdom 25 implements out of the box. Stubbing them
// keeps the tests from blowing up during render.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).scrollIntoView = () => {};
  }
}
