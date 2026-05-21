// Dash — Operations Command Center. React port of the legacy
// frontend/js/pages/dash-* modules, restored to the PHANTOM SEC "cockpit"
// concept (kit/screens/cockpit.jsx). Layout (top → bottom):
//
//   1. Hero card (next-action cascade — A5 priorities)
//   2. KPI Stat strip (active runs / untriaged / open findings / posture /
//      assets / policy blocks — a flex row of kit `Stat` cards)
//   3. Cockpit grid (responsive 1→3 columns at 1440) of kit `Panel`s:
//      · Live runs        — status dot + mono id + title + toolpack + duration
//      · Untriaged alerts — SevTick edge + mono id + title + age
//      · Policy decisions — Bar(allowed/blocked) + TOP REASONS list
//      · Toolpacks        — risk badge + readiness dot per pack
//      · Asset health     — top movers, health Bar + finding count
//
// Everything below the hero composes the kit primitives + semantic CSS
// classes (Panel / Stat / SevTick / Bar / Chip) against the restored
// --* token palette — no improvised shadcn surfaces, no hard-coded hex.
//
// The hero + each panel degrades gracefully on partial fetch failure —
// the page never gates on a single endpoint, and panels whose data isn't
// exposed by any API render a graceful empty/placeholder state.

import * as React from 'react';
import { Link } from 'react-router-dom';

import { DashHero } from '@/components/DashHero';
import { DashRiskChart } from '@/components/DashRiskChart';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Panel, Stat, SevTick, Bar, type StatKind, type Severity } from '@/components/ui/kit';
import {
  deriveAction,
  readContinueWhereLeftOff,
  useDashState,
  useToolpackReadiness,
  type DashState,
  type ToolpackReadiness,
} from '@/lib/dash';
import { ratingColorVar, useDashCharts, type PostureTrend } from '@/lib/dashCharts';
import { parseFindingMeta, severityClass, severityRank } from '@/lib/findings';
import { useToolpacks } from '@/lib/settings';
import { useScopeAssets } from '@/lib/scopes';
import type { ApprovalEvent, FindingRecord, RunRecord, Toolpack } from '@/lib/types';
import type { ScopeAssetOption } from '@/lib/scopeBuilder';

// ── helpers ────────────────────────────────────────────────────────────

// Compact relative age (mono `.ts` cell) — "3m" / "2h 41m" / "5d".
function formatAge(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

// Wall-clock duration between started/ended (mono cell). Falls back to a
// dash when no start timestamp is present.
function formatDuration(started: string | null, ended: string | null): string {
  if (!started) return '—';
  const s = Date.parse(started);
  if (!Number.isFinite(s)) return '—';
  const e = ended ? Date.parse(ended) : Date.now();
  const secs = Math.max(0, Math.floor((e - s) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// Run status → kit status-dot color token. (No standalone `.dot` class was
// ported, so we render a small token-colored span inline.)
const RUN_DOT_DEFAULT = 'var(--fg-3)';
const RUN_DOT: Record<string, string> = {
  running: 'var(--cy-1)',
  queued: 'var(--cy-2)',
  completed: 'var(--sev-ok)',
  failed: 'var(--sev-crit)',
  stopped: 'var(--policy)',
  blocked: 'var(--policy)',
  unknown: RUN_DOT_DEFAULT,
};

function StatusDot({ color, title }: { color: string; title?: string }) {
  return (
    <span
      aria-hidden="true"
      title={title}
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

// Toolpack risk → kit badge severity. Highest declared risk class wins.
function toolpackRisk(pack: Toolpack): Severity {
  const risks = (pack.risks ?? []).map((r) => String(r).toLowerCase());
  if (pack.policy?.allowExploit || risks.some((r) => r.includes('exploit') || r.includes('destructive'))) {
    return 'crit';
  }
  if (
    pack.policy?.allowCredentialUse ||
    pack.policy?.allowNetworkScan ||
    risks.some((r) => r.includes('cred') || r.includes('scan') || r.includes('network'))
  ) {
    return 'high';
  }
  if (risks.length) return 'med';
  return 'info';
}

// ── KPI Stat strip ──────────────────────────────────────────────────────

function KpiStrip({ state, posture }: { state: DashState; posture: PostureTrend | null }) {
  const activeRuns = state.runs.filter((r) => r.status === 'running' || r.status === 'queued').length;
  const blockedRuns = state.runs.filter((r) => r.status === 'stopped').length;

  const untriaged = state.findings.filter((f) => !f.triage_status || f.triage_status === 'new');
  const critUntriaged = untriaged.filter((f) => severityClass(f.severity) === 'crit').length;
  const openFindings = state.findings.length;
  const critFindings = state.findings.filter((f) => severityClass(f.severity) === 'crit').length;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const policyBlocks = ((state.approvalsHistory.events || []) as ApprovalEvent[]).filter((e) => {
    const t = e.occurredAt ? Date.parse(e.occurredAt) : 0;
    return e.decision === 'denied' && Number.isFinite(t) && t > cutoff;
  }).length;

  const postureCurrent = posture?.current ?? null;
  const latestRating = posture?.sparkline?.[posture.sparkline.length - 1]?.rating;
  const postureKind: StatKind =
    latestRating === 'weak' ? 'crit' : latestRating === 'fair' ? 'policy' : postureCurrent != null ? 'ok' : 'info';

  const stats: Array<{
    k: string;
    v: React.ReactNode;
    d?: React.ReactNode;
    kind?: StatKind;
    trend?: 'up' | 'dn';
  }> = [
    {
      k: 'ACTIVE RUNS',
      v: activeRuns,
      d: `governed · ${blockedRuns} blocked`,
      kind: activeRuns > 0 ? 'cyan' : 'info',
    },
    {
      k: 'UNTRIAGED',
      v: untriaged.length,
      d: critUntriaged ? `${critUntriaged} critical` : 'severity ≥ HIGH',
      kind: critUntriaged > 0 ? 'crit' : untriaged.length > 0 ? 'policy' : 'ok',
    },
    {
      k: 'OPEN FINDINGS',
      v: openFindings,
      d: critFindings ? `${critFindings} critical` : 'no critical',
      kind: critFindings > 0 ? 'crit' : 'info',
    },
    {
      k: 'POSTURE',
      v: postureCurrent ?? '—',
      d:
        posture?.delta == null
          ? `${posture?.runsConsidered ?? 0} runs scored`
          : `${posture.delta > 0 ? '▲' : posture.delta < 0 ? '▼' : '±'} ${Math.abs(posture.delta)} vs baseline`,
      kind: postureKind,
      trend: posture?.delta != null && posture.delta < 0 ? 'up' : posture?.delta ? 'dn' : undefined,
    },
    {
      k: 'POLICY BLOCKS · 24H',
      v: policyBlocks,
      d: 'out-of-scope · expired',
      kind: 'policy',
    },
    {
      k: 'PENDING APPROVALS',
      v: state.approvalsPending,
      d: 'install + scope gates',
      kind: state.approvalsPending > 0 ? 'policy' : 'ok',
    },
  ];

  return (
    <section className="panel" aria-label="Dash KPIs" data-testid="dash-kpis">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gridAutoFlow: 'row',
        }}
        className="dash-kpi-grid"
      >
        {stats.map((s) => (
          <Stat key={s.k} k={s.k} v={s.v} d={s.d} kind={s.kind} trend={s.trend} />
        ))}
      </div>
      {/* responsive column count: 2 (mobile) → 3 (sm) → 6 (lg) */}
      <style>{`
        @media (min-width: 640px) { .dash-kpi-grid { grid-template-columns: repeat(3, 1fr) !important; } }
        @media (min-width: 1024px) { .dash-kpi-grid { grid-template-columns: repeat(6, 1fr) !important; } }
      `}</style>
    </section>
  );
}

// ── Live runs panel ─────────────────────────────────────────────────────

function LiveRunsPanel({ state }: { state: DashState }) {
  const runs = state.runs.slice(0, 6);
  const active = state.runs.filter((r) => r.status === 'running' || r.status === 'queued').length;
  return (
    <Panel
      title="Live runs"
      sub={`GOVERNED · ${active} ACTIVE`}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/runs">All runs</Link>
        </Button>
      }
      flush
      data-testid="dash-runs-card"
    >
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {runs.length === 0 ? (
          <p className="caption" style={{ padding: '12px 14px' }}>
            No recent runs.
          </p>
        ) : (
          runs.map((r: RunRecord) => (
            <Link
              key={r.id}
              to={`/runs/${r.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '8px 88px 1fr auto auto',
                gap: 10,
                alignItems: 'center',
                padding: '8px 12px',
                borderBottom: '1px solid var(--line-1)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <StatusDot color={RUN_DOT[r.status] ?? RUN_DOT_DEFAULT} title={r.status} />
              <span className="mono" style={{ color: 'var(--fg-mono-ts)', fontSize: 'var(--fs-11)' }}>
                {r.id.slice(0, 8)}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.title || r.goal || '(untitled run)'}
              </span>
              <span className="mono" style={{ fontSize: 'var(--fs-10)', color: 'var(--fg-3)' }}>
                {r.scope?.name || '—'}
              </span>
              <span className="ts" style={{ textAlign: 'right' }}>
                {formatDuration(r.started_at, r.ended_at)}
              </span>
            </Link>
          ))
        )}
      </div>
    </Panel>
  );
}

// ── Untriaged alerts panel ──────────────────────────────────────────────

function AlertsPanel({ state }: { state: DashState }) {
  const top = [...state.findings]
    .filter((f) => {
      const s = severityClass(f.severity);
      return s === 'crit' || s === 'high';
    })
    .sort((a, b) => {
      const bySev = severityRank(b.severity) - severityRank(a.severity);
      if (bySev !== 0) return bySev;
      const ta = a.first_seen_at ? Date.parse(a.first_seen_at) : 0;
      const tb = b.first_seen_at ? Date.parse(b.first_seen_at) : 0;
      return tb - ta;
    })
    .slice(0, 6);
  const newCount = state.findings.filter((f) => !f.triage_status || f.triage_status === 'new').length;

  return (
    <Panel
      title="Untriaged · severity ≥ HIGH"
      sub={`${newCount} NEW`}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/alerts">Open queue</Link>
        </Button>
      }
      flush
      data-testid="dash-alerts-card"
    >
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {top.length === 0 ? (
          <p className="caption" style={{ padding: '12px 14px' }}>
            No untriaged high/critical findings.
          </p>
        ) : (
          top.map((f: FindingRecord) => {
            const meta = parseFindingMeta(f);
            const host = (meta.target as string) || (meta.host as string) || '';
            return (
              <Link
                key={f.id}
                to="/alerts"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '3px 78px 1fr 60px',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 12px 8px 0',
                  borderBottom: '1px solid var(--line-1)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <SevTick s={severityClass(f.severity) as Severity} />
                <span className="mono" style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-3)' }}>
                  {f.id.slice(0, 8)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.title || '(untitled)'}
                  </span>
                  {host ? <span className="caption">{host}</span> : null}
                </span>
                <span className="ts" style={{ textAlign: 'right' }}>
                  {formatAge(f.first_seen_at)}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </Panel>
  );
}

// ── Policy decisions panel ──────────────────────────────────────────────

function PolicyPanel({ state }: { state: DashState }) {
  const events = (state.approvalsHistory.events || []) as ApprovalEvent[];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => {
    const t = e.occurredAt ? Date.parse(e.occurredAt) : 0;
    return Number.isFinite(t) && t > cutoff;
  });

  const blocked = recent.filter((e) => e.decision === 'denied').length;
  const allowed = recent.filter(
    (e) => e.decision === 'granted' || e.decision === 'allow-once' || e.decision === 'override',
  ).length;
  const total = blocked + allowed;
  const blockedPct = total > 0 ? Math.round((blocked / total) * 100) : 0;
  const allowedPct = total > 0 ? Math.round((allowed / total) * 100) : 0;

  // Top denial reasons (24h) — group denied events by their `reason` text.
  const reasonCounts = new Map<string, number>();
  for (const e of recent) {
    if (e.decision !== 'denied') continue;
    const reason = (e.reason || 'unspecified').trim();
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <Panel title="Policy decisions · 24h" sub="POLICY GATE · BLOCKED · ALLOWED" flush data-testid="dash-policy-card">
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span className="mono" style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-3)' }}>
            BLOCKED
          </span>
          <span className="grow" />
          <span className="mono" style={{ fontSize: 'var(--fs-11)', color: 'var(--policy)' }}>
            {blocked}
          </span>
        </div>
        <Bar pct={blockedPct} kind="crit" />
        <div style={{ display: 'flex', alignItems: 'center', margin: '14px 0 6px' }}>
          <span className="mono" style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-3)' }}>
            ALLOWED
          </span>
          <span className="grow" />
          <span className="mono" style={{ fontSize: 'var(--fs-11)', color: 'var(--sev-ok)' }}>
            {allowed}
          </span>
        </div>
        <Bar pct={allowedPct} kind="ok" />

        <div className="divider" style={{ margin: '14px 0' }} />
        <div className="caption" style={{ marginBottom: 6 }}>
          TOP REASONS
        </div>
        {topReasons.length === 0 ? (
          <p className="caption">No blocked decisions in the last day.</p>
        ) : (
          topReasons.map(([reason, n]) => (
            <div key={reason} style={{ display: 'flex', padding: '4px 0', fontSize: 'var(--fs-12)' }}>
              <span style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {reason}
              </span>
              <span className="grow" />
              <span className="mono" style={{ color: 'var(--fg-1)' }}>
                {n}
              </span>
            </div>
          ))
        )}
        <Button variant="ghost" size="sm" asChild className="mt-3 w-full">
          <Link to="/approvals">Open approvals</Link>
        </Button>
      </div>
    </Panel>
  );
}

// ── Toolpacks panel ─────────────────────────────────────────────────────

const RISK_LABEL: Record<Severity, string> = {
  crit: 'high',
  high: 'med',
  med: 'low',
  low: 'low',
  info: 'safe',
  ok: 'safe',
};

// Readiness bucket → status-dot color + tooltip text.
const READINESS_DOT: Record<ToolpackReadiness, { color: string; title: string }> = {
  ready: { color: 'var(--sev-ok)', title: 'all tools on PATH' },
  partial: { color: 'var(--policy)', title: 'some tools missing' },
  missing: { color: 'var(--sev-crit)', title: 'no tools on PATH' },
  unknown: { color: 'var(--fg-3)', title: 'availability unknown' },
};

function ToolpacksPanel() {
  const { data: toolpacks, isLoading, isError } = useToolpacks();
  const packs = (toolpacks ?? []).slice(0, 8);
  // Fan out a $PATH availability probe per visible pack (real readiness,
  // not the bare /api/toolpacks list which omits the .available flag).
  const readiness = useToolpackReadiness(packs.map((tp) => tp.id));

  return (
    <Panel title="Toolpacks" sub="AVAILABILITY · POLICY CLASS" flush data-testid="dash-toolpacks-card">
      <div>
        {isLoading ? (
          <p className="caption" style={{ padding: '12px 14px' }}>
            Loading toolpacks…
          </p>
        ) : isError || packs.length === 0 ? (
          <p className="caption" style={{ padding: '12px 14px' }}>
            No toolpacks available.
          </p>
        ) : (
          packs.map((tp) => {
            const risk = toolpackRisk(tp);
            const toolNames = (tp.tools ?? []).map((t) => t.name).filter(Boolean).join(' · ');
            const probe = readiness[tp.id] ?? { readiness: 'unknown', isLoading: false, isError: false };
            // While the availability probe is in flight (or it errored) we
            // fall back to the unknown (neutral) dot rather than guessing.
            const bucket: ToolpackReadiness = probe.isLoading || probe.isError ? 'unknown' : probe.readiness;
            const dot = READINESS_DOT[bucket];
            const title = probe.isLoading ? 'checking availability…' : probe.isError ? 'availability check failed' : dot.title;
            return (
              <div
                key={tp.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--line-1)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-1)' }}>{tp.name || tp.id}</div>
                  <div
                    className="mono"
                    style={{ fontSize: 'var(--fs-10)', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {toolNames || tp.category || '—'}
                  </div>
                </div>
                <span className={`badge ${risk}`}>{RISK_LABEL[risk]}</span>
                <StatusDot color={dot.color} title={title} />
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

// ── Asset health · movers panel ─────────────────────────────────────────

// Numeric severity rank → kit severity class (for the worst-finding tick).
function rankToSeverity(rank: number): Severity {
  if (rank >= 4) return 'crit';
  if (rank >= 3) return 'high';
  if (rank >= 2) return 'med';
  if (rank >= 1) return 'low';
  return 'info';
}

function AssetHealthPanel({ state }: { state: DashState }) {
  const { data: assets, isLoading } = useScopeAssets();
  const assetList = assets ?? [];

  // Real aggregation of the EXISTING /api/findings data, keyed by f.assetId.
  // Each open finding carries {assetId, severity, status}; we roll those up
  // into per-asset open-finding counts + worst severity. /api/assets only
  // ships {id,name,type} (no health field of its own), so this findings-
  // derived signal IS the health signal — we label it honestly as such and
  // never fabricate a score the API doesn't back.
  const nameById = new Map(assetList.map((a: ScopeAssetOption) => [a.id, a]));
  const byAsset = new Map<string, { count: number; worst: number }>();
  for (const f of state.findings) {
    if (!f.assetId) continue;
    const cur = byAsset.get(f.assetId) ?? { count: 0, worst: 0 };
    cur.count += 1;
    cur.worst = Math.max(cur.worst, severityRank(f.severity));
    byAsset.set(f.assetId, cur);
  }

  // Union of catalogued assets (/api/assets) and any asset id seen on a
  // finding — so a clean catalogued asset still shows (full health, 0 fnd)
  // and a finding referencing an un-catalogued asset still surfaces. Each
  // row's health + worst-severity come straight from the findings rollup.
  const assetIds = new Set<string>([...nameById.keys(), ...byAsset.keys()]);
  const scored = [...assetIds]
    .map((id) => {
      const agg = byAsset.get(id) ?? { count: 0, worst: 0 };
      const known = nameById.get(id);
      // Findings-derived health: 100 − weighted open-finding load, clamped.
      const health = Math.max(0, Math.min(100, 100 - agg.count * 6 - agg.worst * 8));
      return {
        id,
        name: known?.name ?? id,
        type: known?.type ?? 'asset',
        findings: agg.count,
        worst: agg.worst,
        health,
      };
    })
    // Heaviest load first: worst severity, then count, then lowest health.
    .sort((a, b) => b.worst - a.worst || b.findings - a.findings || a.health - b.health)
    .slice(0, 6);

  return (
    <Panel
      title="Asset health · top movers"
      sub="FINDINGS-DERIVED · OPEN-FINDING LOAD"
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/assets">All assets</Link>
        </Button>
      }
      flush
      data-testid="dash-assets-card"
    >
      <div>
        {isLoading && scored.length === 0 ? (
          <p className="caption" style={{ padding: '12px 14px' }}>
            Loading assets…
          </p>
        ) : scored.length === 0 ? (
          <p className="caption" style={{ padding: '12px 14px' }}>
            No assets monitored yet.
          </p>
        ) : (
          scored.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '3px 1fr 80px 72px',
                gap: 10,
                alignItems: 'center',
                padding: '8px 12px 8px 0',
                borderBottom: '1px solid var(--line-1)',
              }}
            >
              <SevTick s={rankToSeverity(a.worst)} />
              <div style={{ minWidth: 0 }}>
                <div
                  className="mono"
                  style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {a.name}
                </div>
                <div className="caption">{a.type || 'asset'}</div>
              </div>
              <Bar pct={a.health} kind={a.health < 50 ? 'crit' : a.health < 75 ? 'high' : 'ok'} />
              <span className="mono" style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-2)', textAlign: 'right' }}>
                {a.health} · {a.findings} fnd
              </span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

// ── Page shell ────────────────────────────────────────────────────────

function DashSkeleton() {
  return (
    <div className="space-y-3" data-testid="dash-loading">
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-6 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
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
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start"
              data-testid="dash-cockpit"
            >
              <LiveRunsPanel state={data} />
              <AlertsPanel state={data} />
              <PolicyPanel state={data} />
              <ToolpacksPanel />
              <AssetHealthPanel state={data} />
            </section>

            <Card data-testid="dash-governance-card">
              <CardHeader>
                <CardTitle>Governance activity</CardTitle>
                <CardDescription>14-day approval volume and risk-class breakdown</CardDescription>
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
                <p className="text-sm text-foreground">PHANTOM setup isn't complete yet.</p>
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
