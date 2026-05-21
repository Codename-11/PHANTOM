// DashRiskChart — the Dash's "Governance activity (14 days)" card,
// porting the legacy approvals-page.js renderSparkline() + renderRiskBreakdown().
//
// Two stacked pieces, both fed by GET /api/approvals/stats:
//   1. A 14-day bar sparkline of daily approval-event volume.
//   2. A by-risk-class breakdown using the shared Progress ratio bar.
//
// Hand-written SVG only (bundle guardrail); ratio bars reuse ui/progress.

import { Progress } from '@/components/ui/progress';
import { Tooltip } from '@/components/ui/tooltip';
import type { ApprovalStats } from '@/lib/dashCharts';

import { DashSparkBars } from './DashSparkline';

// Risk classes map to muted-token bar colors. Unknown classes fall back
// to cyan so a new class still renders rather than vanishing.
function riskBarColor(risk: string): string {
  const r = risk.toLowerCase();
  if (['exploit', 'destructive', 'online-bruteforce'].includes(r)) return 'bg-[var(--danger)]';
  if (['credentialed', 'offline-password-audit'].includes(r)) return 'bg-[var(--warn-2)]';
  if (['recon', 'passive', 'readonly'].includes(r)) return 'bg-[var(--ok-2)]';
  return 'bg-[var(--cy-2)]';
}

export interface DashRiskChartProps {
  stats: ApprovalStats;
}

export function DashRiskChart({ stats }: DashRiskChartProps) {
  const series = stats.series ?? [];
  const total14d = series.reduce((sum, d) => sum + d.count, 0);
  const titles = series.map((d) => `${d.day} · ${d.count} decision${d.count === 1 ? '' : 's'}`);

  const riskEntries = Object.entries(stats.byRisk ?? {}).sort((a, b) => b[1] - a[1]);
  const riskTotal = riskEntries.reduce((sum, [, n]) => sum + n, 0) || 1;

  return (
    <section data-testid="dash-risk-chart" className="space-y-4">
      {/* 14-day volume sparkline */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="font-mono uppercase tracking-[0.06em] text-[10px] text-muted-foreground">
            Decisions · last 14 days
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{total14d} total</span>
        </div>
        {series.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No governance activity recorded yet.</p>
        ) : (
          <DashSparkBars
            values={series.map((d) => d.count)}
            titles={titles}
            width={320}
            height={36}
            className="w-full h-9"
            ariaLabel={`Approval decisions per day over the last 14 days (${total14d} total)`}
          />
        )}
      </div>

      {/* By-risk breakdown */}
      <div>
        <span className="font-mono uppercase tracking-[0.06em] text-[10px] text-muted-foreground">
          By risk class
        </span>
        {riskEntries.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-muted-foreground">No approvals recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 list-none m-0 p-0">
            {riskEntries.map(([risk, n]) => {
              const pct = Math.round((100 * n) / riskTotal);
              return (
                <li key={risk} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2">
                  <Tooltip content={`${risk} · ${pct}% of decisions`}>
                    <span className="truncate font-mono text-[11px] text-foreground">{risk}</span>
                  </Tooltip>
                  <Progress value={pct} barClassName={riskBarColor(risk)} label={`${risk}: ${pct}%`} />
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{n}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DashRiskChart;
