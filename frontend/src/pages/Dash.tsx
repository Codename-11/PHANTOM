// Dash — Operations Command Center. React port of the legacy
// frontend/js/pages/dash-* modules. Layout (top → bottom):
//
//   1. Hero card (next-action cascade — A5 priorities)
//   2. KPI strip (active campaigns / pending approvals / open findings /
//      today's runs)
//   3. Cockpit row of three Cards:
//      · Live runs (recent runs)
//      · Untriaged alerts (top-5 from /api/findings?status=open)
//      · Policy decisions (count by decision from /api/approvals)
//
// The hero + each cockpit card degrades gracefully on partial fetch
// failure — the page never gates on a single endpoint.

import { Link } from 'react-router-dom';

import { DashHero } from '@/components/DashHero';
import { DashRiskChart } from '@/components/DashRiskChart';
import { DashSparkline } from '@/components/DashSparkline';
import { RunPill } from '@/components/RunPill';
import { SeverityBadge } from '@/components/SeverityBadge';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import {
  deriveAction,
  readContinueWhereLeftOff,
  useDashState,
  type DashState,
} from '@/lib/dash';
import { ratingColorVar, useDashCharts, type PostureTrend } from '@/lib/dashCharts';
import { parseFindingMeta } from '@/lib/findings';
import type { ApprovalEvent } from '@/lib/types';

// ── KPIs ──────────────────────────────────────────────────────────────

type KpiTone = 'neutral' | 'warn' | 'crit' | 'ok' | 'cy';

interface KpiProps {
  label: string;
  value: number | string;
  delta?: string;
  tone?: KpiTone;
  // Optional inline trend line (0..100 series, oldest → newest). Rendered
  // bottom-right via DashSparkline. Colored to match the tile tone.
  spark?: number[];
  sparkColor?: string;
  sparkLabel?: string;
}

const TONE_TEXT: Record<KpiTone, string> = {
  crit: 'text-destructive',
  warn: 'text-[var(--warn-2)]',
  ok: 'text-[var(--ok-2)]',
  cy: 'text-[var(--cy-1)]',
  neutral: 'text-foreground',
};

const TONE_SPARK: Record<KpiTone, string> = {
  crit: 'var(--danger)',
  warn: 'var(--warn-2)',
  ok: 'var(--ok-2)',
  cy: 'var(--cy-1)',
  neutral: 'var(--muted-foreground)',
};

function Kpi({ label, value, delta, tone = 'neutral', spark, sparkColor, sparkLabel }: KpiProps) {
  const color = TONE_TEXT[tone];
  const hasSpark = Array.isArray(spark) && spark.length > 1;
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-1">
        <CardDescription className="font-mono uppercase tracking-[0.06em] text-[10px]">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className={`font-mono text-2xl leading-none ${color}`}>{value}</p>
            {delta ? (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">{delta}</p>
            ) : null}
          </div>
          {hasSpark ? (
            <DashSparkline
              values={spark}
              endRatingColor={sparkColor ?? TONE_SPARK[tone]}
              baseline={false}
              width={64}
              height={26}
              className="shrink-0 opacity-90"
              ariaLabel={sparkLabel ?? `${label} trend`}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function KpiStrip({ state, posture }: { state: DashState; posture: PostureTrend | null }) {
  const activeCampaigns = state.campaigns.filter((c) =>
    ['running', 'paused', 'needs_approval'].includes(c.status),
  ).length;
  const openFindings = state.findings.length;
  const critFindings = state.findings.filter(
    (f) => String(f.severity || '').toLowerCase().startsWith('crit'),
  ).length;
  const todayCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const todaysRuns = state.runs.filter((r) => {
    const t = r.started_at ? Date.parse(r.started_at) : 0;
    return Number.isFinite(t) && t > todayCutoff;
  }).length;

  // Posture score trend (per terminal run, oldest → newest) drives the
  // inline sparkline on the Runs tile. Colored by the latest run's rating.
  const postureScores = (posture?.sparkline ?? []).map((p) => p.score);
  const latestRating = posture?.sparkline?.[posture.sparkline.length - 1]?.rating;
  const postureSparkColor = ratingColorVar(latestRating);
  const postureDelta = posture?.delta;

  return (
    <section
      aria-label="Dash KPIs"
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
      data-testid="dash-kpis"
    >
      <Kpi
        label="Active campaigns"
        value={activeCampaigns}
        tone={activeCampaigns > 0 ? 'cy' : 'neutral'}
        delta={`${state.campaigns.length} total`}
      />
      <Kpi
        label="Pending approvals"
        value={state.approvalsPending}
        tone={state.approvalsPending > 0 ? 'warn' : 'ok'}
        delta="install + scope gates"
      />
      <Kpi
        label="Open findings"
        value={openFindings}
        tone={critFindings > 0 ? 'crit' : openFindings > 0 ? 'warn' : 'ok'}
        delta={critFindings ? `${critFindings} critical` : 'no critical'}
      />
      <Kpi
        label="Posture trend"
        value={posture?.current ?? '—'}
        tone={latestRating === 'weak' ? 'crit' : latestRating === 'fair' ? 'warn' : 'ok'}
        delta={
          postureDelta == null
            ? `${posture?.runsConsidered ?? 0} runs scored`
            : `${postureDelta > 0 ? '▲' : postureDelta < 0 ? '▼' : '±'} ${Math.abs(postureDelta)} vs baseline`
        }
        spark={postureScores}
        sparkColor={postureSparkColor}
        sparkLabel={`Posture score over the last ${postureScores.length} runs`}
      />
      <Kpi
        label="Runs today"
        value={todaysRuns}
        tone={todaysRuns > 0 ? 'cy' : 'neutral'}
        delta={`${state.runs.length} recent`}
      />
    </section>
  );
}

// ── Cockpit row ──────────────────────────────────────────────────────

function LiveRunsCard({ state }: { state: DashState }) {
  const recent = state.runs.slice(0, 5);
  return (
    <Card data-testid="dash-runs-card" className="flex flex-col">
      <CardHeader>
        <CardTitle>Live runs</CardTitle>
        <CardDescription>{recent.length} of the last {state.runs.length} runs</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {recent.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No recent runs.</p>
        ) : (
          <ul className="space-y-1.5 list-none m-0 p-0">
            {recent.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/runs/${r.id}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-[var(--bg-1)] px-2.5 py-1.5 text-[12px] hover:border-[var(--cy-2)] hover:bg-[var(--bg-3)]"
                >
                  <RunPill status={r.status} />
                  <span className="truncate text-foreground">
                    {r.title || r.goal || r.id.slice(0, 8)}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {r.scope?.name || '—'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AlertsCard({ state }: { state: DashState }) {
  const top5 = [...state.findings]
    .sort((a, b) => {
      const sa = a.first_seen_at ? Date.parse(a.first_seen_at) : 0;
      const sb = b.first_seen_at ? Date.parse(b.first_seen_at) : 0;
      return sb - sa;
    })
    .slice(0, 5);
  return (
    <Card data-testid="dash-alerts-card" className="flex flex-col">
      <CardHeader>
        <CardTitle>Untriaged alerts</CardTitle>
        <CardDescription>
          {state.findings.length} open · sorted by recency
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {top5.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No open findings.</p>
        ) : (
          <ul className="space-y-1.5 list-none m-0 p-0">
            {top5.map((f) => {
              const meta = parseFindingMeta(f);
              const host = (meta.target as string) || (meta.host as string) || '—';
              return (
                <li key={f.id}>
                  <Link
                    to="/alerts"
                    className="flex items-center gap-2 rounded-md border border-border bg-[var(--bg-1)] px-2.5 py-1.5 text-[12px] hover:border-[var(--cy-2)] hover:bg-[var(--bg-3)]"
                  >
                    <SeverityBadge severity={f.severity} />
                    <span className="truncate text-foreground">{f.title || '(untitled)'}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {host}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyCard({ state }: { state: DashState }) {
  // Count by decision over the last 24h. /api/approvals already returns
  // the most-recent events first, but doesn't filter by `since` unless
  // we pass one — for the Dash card we just bucket whatever we got back.
  const events = (state.approvalsHistory.events || []) as ApprovalEvent[];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => {
    const t = e.occurredAt ? Date.parse(e.occurredAt) : 0;
    return Number.isFinite(t) && t > cutoff;
  });
  const counts: Record<string, number> = {
    granted: 0,
    denied: 0,
    'allow-once': 0,
    override: 0,
    timeout: 0,
    other: 0,
  };
  for (const e of recent) {
    const key = e.decision && counts[e.decision] !== undefined ? e.decision : 'other';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const total = recent.length;

  return (
    <Card data-testid="dash-policy-card" className="flex flex-col">
      <CardHeader>
        <CardTitle>Policy decisions (24h)</CardTitle>
        <CardDescription>
          {total} decision{total === 1 ? '' : 's'} in the last day
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <dl className="grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-md border border-border bg-[var(--bg-1)] px-2 py-1.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Granted</dt>
            <dd className="font-mono text-base text-[var(--ok-2)]">{counts.granted}</dd>
          </div>
          <div className="rounded-md border border-border bg-[var(--bg-1)] px-2 py-1.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Denied</dt>
            <dd className="font-mono text-base text-destructive">{counts.denied}</dd>
          </div>
          <div className="rounded-md border border-border bg-[var(--bg-1)] px-2 py-1.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Allow once</dt>
            <dd className="font-mono text-base text-[var(--cy-1)]">{counts['allow-once']}</dd>
          </div>
          <div className="rounded-md border border-border bg-[var(--bg-1)] px-2 py-1.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Override</dt>
            <dd className="font-mono text-base text-[var(--warn-2)]">{counts.override}</dd>
          </div>
        </dl>
        <Button variant="ghost" size="sm" asChild className="mt-3 w-full">
          <Link to="/approvals">Open approvals</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Page shell ────────────────────────────────────────────────────────

function DashSkeleton() {
  return (
    <div className="space-y-3" data-testid="dash-loading">
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export function DashPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDashState();
  const charts = useDashCharts();
  const { toast } = useToast();

  const handleRefresh = async () => {
    try {
      await Promise.all([refetch(), charts.refetch()]);
      toast({ title: 'Dash refreshed', variant: 'success' });
    } catch {
      toast({ title: 'Refresh failed', variant: 'error' });
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-4">
        <PageHeader
          eyebrow="Operations Command Center"
          title="Dash"
          description="One pane of glass for system readiness, active campaigns, governance decisions, and untriaged alerts. The hero card surfaces the next concrete action so you always know what to do next."
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                loading={isFetching || charts.isFetching}
                data-testid="refresh-dash-btn"
              >
                ↻ Refresh
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/onboarding">Onboarding</Link>
              </Button>
            </>
          }
        />

        {isLoading ? (
          <DashSkeleton />
        ) : isError || !data ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            Failed to load Dash state: {(error as Error)?.message ?? 'unknown error'}
          </div>
        ) : (
          <>
            <DashHero
              action={deriveAction({
                diag: data.diag,
                checklist: data.checklist,
                campaigns: data.campaigns,
                approvalsPending: data.approvalsPending,
              })}
              continueCard={readContinueWhereLeftOff()}
            />

            <KpiStrip state={data} posture={charts.data?.posture ?? null} />

            <section
              id="cockpit"
              aria-label="Cockpit"
              className="grid grid-cols-1 md:grid-cols-3 gap-3"
              data-testid="dash-cockpit"
            >
              <LiveRunsCard state={data} />
              <AlertsCard state={data} />
              <PolicyCard state={data} />
            </section>

            <Card data-testid="dash-governance-card">
              <CardHeader>
                <CardTitle>Governance activity</CardTitle>
                <CardDescription>
                  14-day approval volume and risk-class breakdown
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DashRiskChart
                  stats={charts.data?.approvalStats ?? { total: 0, byDecision: {}, byRisk: {}, series: [] }}
                />
              </CardContent>
            </Card>

            {data.checklist && !data.checklist.complete ? (
              <section
                id="onboarding-checklist"
                aria-label="Onboarding shortcut"
                className="rounded-md border border-dashed border-border bg-[var(--bg-2)] px-4 py-3 flex items-center gap-3"
              >
                <Badge variant="needs_approval">Get started</Badge>
                <p className="text-sm text-foreground">
                  PHANTOM setup isn't complete yet.
                </p>
                <Button variant="primary" size="sm" asChild className="ml-auto">
                  <Link to="/onboarding">Open checklist</Link>
                </Button>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

export default DashPage;
