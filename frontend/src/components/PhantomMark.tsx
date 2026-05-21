// PHANTOM SEC packet-train logomark.
//
// Recreated faithfully from the design kit's <PhantomMark> (kit/shell.jsx)
// and the animated splash (PHANTOM SEC Splash.html). The mark is a
// governance frame with corner ticks, a dashed flow baseline, and three
// status "packets" crossing left → right, the lead one locked in an
// inspect zone.
//
//  - `size`     scales the SVG; stroke widths step up at small sizes so the
//               frame + ticks stay legible (matches the kit's size<=18 / <=32
//               breakpoints).
//  - `animated` (default false) swaps the three static packets for the
//               packet-train animation (drift + tint + inspection ticks +
//               scan bar + verify dot). The static pose is the sidebar mark;
//               the animated pose is the splash hero. prefers-reduced-motion
//               always falls back to the static composition.
//
// Colors use the global cyan/fg tokens (--cy-1, --fg-1). No hard-coded hex.
import * as React from 'react';

let markSeq = 0;

export interface PhantomMarkProps {
  size?: number;
  animated?: boolean;
  className?: string;
  title?: string;
}

export function PhantomMark({
  size = 26,
  animated = false,
  className,
  title = 'PHANTOM SEC',
}: PhantomMarkProps) {
  // Stable per-instance class so scoped keyframes never collide.
  const uid = React.useMemo(() => `pm${(markSeq += 1)}`, []);

  const frameStroke = size <= 18 ? 2 : 1.5;
  const cornerStroke = size <= 18 ? 2.6 : size <= 32 ? 2 : 1.6;
  const tickStroke = size <= 32 ? 1.8 : 1.4;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      {animated ? (
        <style>{`
          .${uid} .pkt {
            transform-box: fill-box;
            transform-origin: center;
            animation: ${uid}Flow 3.6s cubic-bezier(0.7,0,0.3,1) infinite,
                       ${uid}Tint 3.6s linear infinite;
          }
          .${uid} .p2 { animation-delay: -1.2s, -1.2s; }
          .${uid} .p3 { animation-delay: -2.4s, -2.4s; }
          .${uid} .ticks { animation: ${uid}Ticks 1.2s ease-in-out infinite; }
          .${uid} .scan  { animation: ${uid}Scan 1.2s ease-in-out infinite;
                           transform-box: fill-box; transform-origin: center; }
          .${uid} .verify{ animation: ${uid}Verify 1.2s ease-in-out infinite; }
          .${uid} .baseline { animation: ${uid}Dash 0.6s linear infinite; }
          @keyframes ${uid}Flow {
            0%   { transform: translateX(-30px); opacity: 0; }
            8%   { opacity: .30; }
            25%  { transform: translateX(0);    opacity: .55; }
            50%  { transform: translateX(20px); opacity: .85; }
            66%  { transform: translateX(40px); opacity: 1; }
            88%  { transform: translateX(40px); opacity: 1; }
            100% { transform: translateX(70px); opacity: 0; }
          }
          @keyframes ${uid}Tint {
            0%, 60%  { fill: var(--fg-1); }
            66%, 88% { fill: var(--cy-1); }
            100%     { fill: var(--fg-1); }
          }
          @keyframes ${uid}Ticks {
            0% { opacity: .25; } 30% { opacity: .30; }
            55% { opacity: .85; } 75% { opacity: .85; } 100% { opacity: .25; }
          }
          @keyframes ${uid}Scan {
            0% { opacity: 0; transform: translateY(-22px); }
            30% { opacity: 0; transform: translateY(-22px); }
            45% { opacity: .55; transform: translateY(-10px); }
            65% { opacity: .55; transform: translateY(10px); }
            85% { opacity: 0; transform: translateY(22px); }
            100% { opacity: 0; transform: translateY(22px); }
          }
          @keyframes ${uid}Verify {
            0%, 60% { opacity: 0; } 80% { opacity: .8; }
            90% { opacity: .8; } 100% { opacity: 0; }
          }
          @keyframes ${uid}Dash { to { stroke-dashoffset: -5; } }
          @media (prefers-reduced-motion: reduce) {
            .${uid} .pkt,
            .${uid} .ticks,
            .${uid} .scan,
            .${uid} .verify,
            .${uid} .baseline { animation: none; }
            .${uid} .scan,
            .${uid} .verify { display: none; }
          }
        `}</style>
      ) : null}

      <g className={animated ? uid : undefined}>
        {/* governance frame */}
        <rect
          x="1"
          y="1"
          width="94"
          height="94"
          stroke="var(--cy-1)"
          strokeOpacity=".22"
          strokeWidth={frameStroke}
        />
        {/* corner ticks */}
        <path
          d="M1 14 V1 H14 M82 1 H95 V14 M1 82 V95 H14 M82 95 H95 V82"
          stroke="var(--cy-1)"
          strokeWidth={cornerStroke}
          fill="none"
        />
        {/* flow baseline · dashed (drifts when animated) */}
        <line
          className={animated ? 'baseline' : undefined}
          x1="14"
          y1="48"
          x2="82"
          y2="48"
          stroke="var(--cy-1)"
          strokeOpacity={animated ? '.28' : '.25'}
          strokeWidth="1"
          strokeDasharray="3 2"
        />

        {animated ? (
          <>
            {/* three packets crossing the scope */}
            <rect className="pkt p1" x="6" y="40" width="14" height="16" fill="var(--fg-1)" />
            <rect className="pkt p2" x="6" y="40" width="14" height="16" fill="var(--fg-1)" />
            <rect className="pkt p3" x="6" y="40" width="14" height="16" fill="var(--fg-1)" />
            {/* inspection ticks framing the inspect zone */}
            <g className="ticks">
              <path
                d="M46 36 V40 M60 36 V40 M46 56 V60 M60 56 V60"
                stroke="var(--cy-1)"
                strokeWidth={tickStroke}
              />
            </g>
            {/* vertical scan bar sweeping the inspect zone */}
            <rect className="scan" x="46" y="47" width="14" height="2" fill="var(--cy-1)" rx="1" />
            {/* verify dot — "packet cleared" */}
            <g className="verify">
              <circle cx="79" cy="86" r="3" fill="var(--ok, #4ade80)" />
            </g>
          </>
        ) : (
          <>
            {/* static three-packet pose (sidebar / favicon composition) */}
            <rect x="22" y="40" width="14" height="16" fill="var(--fg-1)" opacity=".35" />
            <rect x="42" y="40" width="14" height="16" fill="var(--fg-1)" opacity=".7" />
            <rect x="62" y="40" width="14" height="16" fill="var(--cy-1)" />
            {size > 20 ? (
              <path
                d="M62 36 V40 M76 36 V40 M62 56 V60 M76 56 V60"
                stroke="var(--cy-1)"
                strokeWidth={tickStroke}
              />
            ) : null}
          </>
        )}
      </g>
    </svg>
  );
}

export default PhantomMark;
