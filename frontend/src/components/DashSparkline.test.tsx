// DashSparkline / DashRiskChart — render tests for the A8.5b parity-close
// chart ports. These are pure presentational SVG components, so we assert
// on the rendered SVG/structure rather than mocking fetch.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DashSparkline, DashSparkBars } from './DashSparkline';
import { DashRiskChart } from './DashRiskChart';
import type { ApprovalStats } from '@/lib/dashCharts';

describe('DashSparkline', () => {
  it('renders a polyline with one point per value', () => {
    const { container } = render(
      <DashSparkline values={[10, 50, 90]} ariaLabel="posture" />,
    );
    const poly = container.querySelector('polyline');
    expect(poly).not.toBeNull();
    // 3 points → 3 coordinate pairs.
    expect(poly!.getAttribute('points')!.trim().split(' ')).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'posture' })).toBeInTheDocument();
  });

  it('renders an empty placeholder when there is no data', () => {
    const { container } = render(<DashSparkline values={[]} />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});

describe('DashSparkBars', () => {
  it('renders one bar per day', () => {
    const { container } = render(<DashSparkBars values={[0, 2, 5, 1]} />);
    expect(container.querySelectorAll('rect')).toHaveLength(4);
  });
});

describe('DashRiskChart', () => {
  const stats: ApprovalStats = {
    total: 6,
    byDecision: { granted: 4, denied: 2 },
    byRisk: { recon: 4, exploit: 2 },
    series: Array.from({ length: 14 }, (_, i) => ({
      day: `2026-05-${String(i + 1).padStart(2, '0')}`,
      count: i % 3,
    })),
  };

  it('renders the 14-day total and risk-class rows', () => {
    render(<DashRiskChart stats={stats} />);
    const total = stats.series.reduce((s, d) => s + d.count, 0);
    expect(screen.getByText(`${total} total`)).toBeInTheDocument();
    expect(screen.getByText('recon')).toBeInTheDocument();
    expect(screen.getByText('exploit')).toBeInTheDocument();
  });

  it('shows empty states when there is no data', () => {
    render(<DashRiskChart stats={{ total: 0, byDecision: {}, byRisk: {}, series: [] }} />);
    expect(screen.getByText(/No governance activity/i)).toBeInTheDocument();
    expect(screen.getByText(/No approvals recorded yet/i)).toBeInTheDocument();
  });
});
