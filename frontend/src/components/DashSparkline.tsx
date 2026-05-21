// DashSparkline — hand-written inline-SVG trend line for the Dash KPI
// tiles. Ported from the legacy frontend/js/pages/trending-panel.js
// renderSparkline(): a polyline across the series with a 50-baseline
// guide and color-coded end dot. No charting library (bundle guardrail).
//
// Generic over a numeric series so it can also drive the small bar
// sparkline of daily approval counts (DashSparkBars below).

import * as React from 'react';

export interface DashSparklineProps {
  // Score series, oldest → newest, each 0..100.
  values: number[];
  // Per-point rating used to color the trailing dot. Optional.
  endRatingColor?: string;
  // Whether to draw the 50-line baseline guide. Default true.
  baseline?: boolean;
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

// Line sparkline for 0..100 scores (posture trend).
export function DashSparkline({
  values,
  endRatingColor = 'var(--cy-1)',
  baseline = true,
  width = 120,
  height = 32,
  className,
  ariaLabel,
}: DashSparklineProps) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return (
      <div
        className={className}
        style={{ width, height }}
        aria-label={ariaLabel ?? 'No trend data'}
        role="img"
      />
    );
  }

  const pad = 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = clean.length > 1 ? innerW / (clean.length - 1) : 0;
  const yFor = (score: number) =>
    pad + innerH - (Math.max(0, Math.min(100, score)) / 100) * innerH;

  const points = clean.map((v, i) => `${pad + i * stepX},${yFor(v).toFixed(1)}`).join(' ');
  const lastX = pad + (clean.length - 1) * stepX;
  const lastY = yFor(clean[clean.length - 1] ?? 0);
  const baseY = yFor(50);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={ariaLabel ?? `Trend over the last ${clean.length} runs`}
      preserveAspectRatio="none"
    >
      {baseline ? (
        <line
          x1={pad}
          y1={baseY}
          x2={width - pad}
          y2={baseY}
          stroke="var(--line-2)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      ) : null}
      <polyline
        points={points}
        fill="none"
        stroke={endRatingColor}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={2.5} fill={endRatingColor} />
    </svg>
  );
}

export interface DashSparkBarsProps {
  // Daily counts, oldest → newest.
  values: number[];
  width?: number;
  height?: number;
  barColor?: string;
  className?: string;
  ariaLabel?: string;
  // Optional per-bar title labels (e.g. "2026-05-20 · 3").
  titles?: string[];
}

// Bar sparkline for daily counts (14-day approval volume). Ported from
// the legacy approvals-page.js renderSparkline() bar variant.
export function DashSparkBars({
  values,
  width = 120,
  height = 32,
  barColor = 'var(--cy-2)',
  className,
  ariaLabel,
  titles,
}: DashSparkBarsProps) {
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(1, ...clean);
  const n = clean.length || 1;
  const gap = 1.5;
  const barW = Math.max(1, (width - gap * (n - 1)) / n);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={ariaLabel ?? `Daily volume over ${clean.length} days`}
      preserveAspectRatio="none"
    >
      {clean.map((v, i) => {
        const h = Math.max(1, Math.round((v / max) * (height - 2)));
        const x = i * (barW + gap);
        const y = height - h;
        return (
          <rect
            key={i}
            x={x.toFixed(1)}
            y={y.toFixed(1)}
            width={barW.toFixed(1)}
            height={h}
            rx={0.5}
            fill={barColor}
            opacity={v === 0 ? 0.25 : 1}
          >
            {titles && titles[i] ? <title>{titles[i]}</title> : null}
          </rect>
        );
      })}
    </svg>
  );
}

export default DashSparkline;
