// ApprovalsKpiStrip — page-scoped KPI strip for the Approvals page.
//
// Ports the legacy frontend/js/pages/approvals-page.js renderKpis(): a
// row of stat cards counting decision events (total / granted / denied /
// allow-once / override) plus a derived approve-rate. Counts come from
// /api/approvals/stats (ApprovalStats), surfaced through the approvals
// bundle. The "pending" tile reflects the live install queue length.
import { Tooltip } from '@/components/ui/tooltip';
import type { ApprovalStats } from '@/lib/approvals';

interface KpiTile {
  key: string;
  label: string;
  value: number | string;
  delta: string;
  // Accent token for the value text. Falls back to muted foreground.
  accent?: string;
}

interface ApprovalsKpiStripProps {
  stats: ApprovalStats;
  pendingCount: number;
}

export function ApprovalsKpiStrip({ stats, pendingCount }: ApprovalsKpiStripProps) {
  const s = stats.byDecision ?? {};
  const total = stats.total ?? 0;
  const granted = s.granted ?? 0;
  const denied = s.denied ?? 0;
  const allowOnce = s['allow-once'] ?? 0;
  const override = s.override ?? 0;
  const timeout = s.timeout ?? 0;
  const approveRate = total ? Math.round((100 * (granted + allowOnce)) / total) : 0;

  const tiles: KpiTile[] = [
    { key: 'pending', label: 'Pending', value: pendingCount, delta: 'awaiting review', accent: 'var(--warn-2)' },
    { key: 'total', label: 'Total', value: total, delta: 'events' },
    { key: 'granted', label: 'Granted', value: granted, delta: 'ask gates', accent: 'var(--ok-2)' },
    { key: 'denied', label: 'Denied', value: denied, delta: `${timeout} timeouts`, accent: 'hsl(var(--destructive))' },
    { key: 'allow-once', label: 'Allow-once', value: allowOnce, delta: 'one-time overrides', accent: 'var(--cy-1)' },
    { key: 'override', label: 'Override', value: override, delta: 'operator override', accent: 'var(--warn-2)' },
    { key: 'rate', label: 'Approve rate', value: `${approveRate}%`, delta: 'granted ÷ total' },
  ];

  return (
    <section
      aria-label="Approval decision stats"
      data-testid="approvals-kpi"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7 mb-4"
    >
      {tiles.map((t) => (
        <Tooltip key={t.key} content={t.delta} side="bottom">
          <div
            data-testid={`approvals-kpi-${t.key}`}
            className="flex w-full flex-col rounded-md border border-border bg-card px-3 py-2.5"
          >
            <span className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
              {t.label}
            </span>
            <span
              className="mt-0.5 text-xl font-semibold tabular-nums"
              style={t.accent ? { color: t.accent } : undefined}
            >
              {t.value}
            </span>
            <span className="mt-0.5 text-[10px] text-[var(--fg-3)]">{t.delta}</span>
          </div>
        </Tooltip>
      ))}
    </section>
  );
}

export default ApprovalsKpiStrip;
