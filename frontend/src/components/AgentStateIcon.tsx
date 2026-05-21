// PHANTOM SEC — Agent state icons (React port of the foundations
// artboard `kit/agent-states.jsx`). Four isometric animated states for
// agent surfaces:
//
//   LOADING  — generic agent busy (stacked iso tiles, sequenced pulse)
//   SCANNING — active recon (anchored emitter, rotating cyan beam over a
//              3x3 host node grid)
//   ENGAGING — authorized active action (packets through a governance
//              frame, sev-high impact pulse + tumblers on the host face)
//   VERIFIED — run-success / policy-approved (green check draw over a
//              ghost cube; plays once on a `play` toggle)
//
// Each icon is wrapped in `.psas` (which carries the local easing vars)
// plus its `.anim-<state>` class. The animation rules + keyframes live in
// `src/styles/agent-states.css`; color tokens live in globals.css. Three
// states loop; VERIFIED plays once and replays whenever `play` flips true.
import { useEffect, useRef, useState } from 'react';

interface IconProps {
  /** Rendered pixel size (width === height). Defaults to 24. */
  size?: number;
  className?: string;
}

// Shared wrapper: applies the `.psas` scope so the local easing vars and
// `.anim-*` selectors resolve. aria-hidden — these are decorative.
function Psas({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={className ? `psas ${className}` : 'psas'}>{children}</span>;
}

export function LoadingIcon({ size = 24, className }: IconProps) {
  return (
    <Psas className={className}>
      <svg
        className="anim-loading"
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        data-state="loading"
      >
        <polygon className="ld-tile ld-tile-c" points="32,34 50.78,44.83 32,55.66 13.22,44.83" />
        <polygon className="ld-tile ld-tile-b" points="32,24 50.78,34.83 32,45.66 13.22,34.83" />
        <polygon className="ld-tile ld-tile-a" points="32,14 50.78,24.83 32,35.66 13.22,24.83" />
      </svg>
    </Psas>
  );
}

export function ScanningIcon({ size = 24, className }: IconProps) {
  return (
    <Psas className={className}>
      <svg
        className="anim-scanning"
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        data-state="scanning"
      >
        <polygon className="sc-plane" points="32,22 53.78,34 32,46 10.22,34" />
        <polyline className="sc-bracket" points="8,32 8,18 22,18" />
        <polyline className="sc-bracket" points="56,40 56,54 42,54" />
        <polygon className="sc-emitter-top" points="32,4 35.46,6 32,8 28.54,6" />
        <polygon className="sc-emitter-l" points="32,8 28.54,6 28.54,10 32,12" />
        <polygon className="sc-emitter-r" points="32,8 35.46,6 35.46,10 32,12" />
        <polygon className="sc-beam" points="32,12 29,42 35,42" />
        <circle className="sc-node sc-col-l" cx="25.07" cy="32" r="1.6" />
        <circle className="sc-node sc-col-l" cx="18.14" cy="36" r="1.6" />
        <circle className="sc-node sc-col-l" cx="25.07" cy="40" r="1.6" />
        <circle className="sc-node sc-col-c" cx="32" cy="28" r="1.6" />
        <circle className="sc-node sc-col-c" cx="32" cy="36" r="1.6" />
        <circle className="sc-node sc-col-c" cx="32" cy="44" r="1.6" />
        <circle className="sc-node sc-col-r" cx="38.93" cy="32" r="1.6" />
        <circle className="sc-node sc-col-r" cx="45.86" cy="36" r="1.6" />
        <circle className="sc-node sc-col-r" cx="38.93" cy="40" r="1.6" />
      </svg>
    </Psas>
  );
}

export function EngagingIcon({ size = 24, className }: IconProps) {
  return (
    <Psas className={className}>
      <svg
        className="anim-engaging"
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        data-state="engaging"
      >
        <rect className="en-policy" x="10" y="10" width="44" height="44" />
        <polyline className="en-corner" points="10,18 10,10 18,10" />
        <polyline className="en-corner" points="46,10 54,10 54,18" />
        <polyline className="en-corner" points="54,46 54,54 46,54" />
        <polyline className="en-corner" points="18,54 10,54 10,46" />
        <polygon className="en-cube-top" points="34,21 43.526,26.5 34,32 24.474,26.5" />
        <polygon className="en-cube-l" points="34,32 24.474,26.5 24.474,37.5 34,43" />
        <polygon className="en-cube-r" points="34,32 43.526,26.5 43.526,37.5 34,43" />
        <polygon className="en-bar en-bar-1" points="35.516,35.125 36.815,34.375 36.815,37.375 35.516,38.125" />
        <polygon className="en-bar en-bar-2" points="38.114,33.625 39.413,32.875 39.413,35.875 38.114,36.625" />
        <polygon className="en-bar en-bar-3" points="40.711,32.125 42.011,31.375 42.011,34.375 40.711,35.125" />
        <polygon className="en-topflash" points="34,21 43.526,26.5 34,32 24.474,26.5" />
        <polygon className="en-hitface" points="34,32 24.474,26.5 24.474,37.5 34,43" />
        <circle className="en-inspect" cx="10" cy="24.5" r="1.4" />
        <circle className="en-impact" cx="29.24" cy="34.75" r="2.2" />
        <polygon className="en-packet p1" points="10,22.6 12.6,24.5 10,26.4 7.4,24.5" />
        <polygon className="en-packet p2" points="10,22.6 12.6,24.5 10,26.4 7.4,24.5" />
        <polygon className="en-packet p3" points="10,22.6 12.6,24.5 10,26.4 7.4,24.5" />
      </svg>
    </Psas>
  );
}

interface VerifiedIconProps extends IconProps {
  /** When true the check/ring/cube draw-in animation plays once. Flip
      false→true to replay (e.g. on each fresh run-success). Defaults to
      true so a freshly-mounted icon animates in. */
  play?: boolean;
}

export function VerifiedIcon({ size = 24, className, play = true }: VerifiedIconProps) {
  // The CSS keys the once-only animation off the `.play` class. To make
  // the animation re-fire when `play` flips true again we drop and re-add
  // the class after a forced reflow — mirroring the artboard's replay().
  const svgRef = useRef<SVGSVGElement>(null);
  const [armed, setArmed] = useState(play);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (play) {
      el.classList.remove('play');
      // Force reflow so removing then re-adding restarts the animation.
      void el.getBoundingClientRect();
      el.classList.add('play');
      setArmed(true);
    } else {
      el.classList.remove('play');
      setArmed(false);
    }
  }, [play]);

  return (
    <Psas className={className}>
      <svg
        ref={svgRef}
        className={armed ? 'anim-verified play' : 'anim-verified'}
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        data-state="verified"
      >
        <g className="vf-cube">
          <polygon className="vf-cube-top" points="32,24 40.66,29 32,34 23.34,29" />
          <polygon className="vf-cube-l" points="32,34 23.34,29 23.34,39 32,44" />
          <polygon className="vf-cube-r" points="32,34 40.66,29 40.66,39 32,44" />
        </g>
        <circle className="vf-ring" cx="32" cy="32" r="14" />
        <path className="vf-check" d="M 22 33 L 30 41 L 44 23" />
      </svg>
    </Psas>
  );
}
