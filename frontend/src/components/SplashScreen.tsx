// PHANTOM SEC boot / Suspense splash.
//
// Full-viewport centered boot screen: the animated packet-train PhantomMark
// + "PHANTOM SEC" wordmark + an "INITIALIZING" caption. Recreated from the
// canonical splash (PHANTOM SEC Splash.html, SPL.01).
//
// This renders as React's Suspense fallback, which can mount BEFORE the app
// CSS (globals.css token layer + utility classes) has fully settled. So the
// component is intentionally self-contained: a scoped <style> block carries
// its own layout + keyframes, and color tokens fall back to literal values
// (--cy-1 / --fg-1 / --bg-0 defaults) if the cascade hasn't loaded yet. When
// tokens ARE present they win, keeping it on-brand in light + dark themes.
//
// prefers-reduced-motion collapses to a static pose (no drift, no spinner).
import * as React from 'react';

import { PhantomMark } from './PhantomMark';

export function SplashScreen() {
  return (
    <div className="phantom-splash" role="status" aria-live="polite" aria-busy="true">
      <style>{`
        .phantom-splash {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 22px;
          background:
            radial-gradient(ellipse at top, rgba(95,182,255,0.06), transparent 60%),
            var(--bg-0, #0a0c10);
          color: var(--fg-1, #e8edf5);
          font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
        }
        .phantom-splash__word {
          font-weight: 600;
          letter-spacing: .22em;
          font-size: 26px;
          text-align: center;
          color: var(--fg-1, #e8edf5);
        }
        .phantom-splash__sub {
          display: block;
          margin-top: 6px;
          font-size: 10px;
          font-weight: 400;
          letter-spacing: .14em;
          color: var(--fg-3, #6a7587);
        }
        .phantom-splash__row {
          display: flex;
          align-items: center;
          gap: 14px;
          font-size: 11px;
          letter-spacing: .14em;
        }
        .phantom-splash__cap { color: var(--cy-1, #5fb6ff); }
        .phantom-splash__spin {
          width: 11px;
          height: 11px;
          border: 1.2px solid var(--cy-1, #5fb6ff);
          border-top-color: transparent;
          border-radius: 50%;
          animation: phantomSpin 0.7s linear infinite;
        }
        @keyframes phantomSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .phantom-splash__spin {
            animation: none;
            border-top-color: var(--cy-1, #5fb6ff);
          }
        }
      `}</style>

      <PhantomMark size={150} animated title="PHANTOM SEC initializing" />

      <span className="phantom-splash__word">
        PHANTOM SEC
        <span className="phantom-splash__sub">GOVERNED AI · SECURITY OPS</span>
      </span>

      <div className="phantom-splash__row">
        <span className="phantom-splash__spin" aria-hidden="true" />
        <span className="phantom-splash__cap">INITIALIZING</span>
      </div>
    </div>
  );
}

export default SplashScreen;
