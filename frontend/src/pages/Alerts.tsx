// Alerts — triage queue for findings. Filter chips by severity +
// triage status; clicking a row opens a Sheet with the full finding
// detail + a 4-button TriageRail at the bottom.
//
// Mirrors the legacy frontend/js/pages/alerts-page.js contract:
//   - GET /api/findings
//   - PATCH /api/findings/:id/triage with { triageStatus, dismissalNote }
//   - HTTP 400 + code dismissal_note_required for high|crit dismissal
//
// The legacy /alerts page stays untouched; this React preview lives at
// /react/alerts.

import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';

import { SeverityBadge } from '@/components/SeverityBadge';
import { TriageRail } from '@/components/TriageRail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  parseFindingMeta,
  severityRank,
  useFindings,
  useTriage,
} from '@/lib/findings';
import type {
  FindingRecord,
  FindingTriageStatus,
} from '@/lib/types';

// ── Filters ───────────────────────────────────────────────────────────

const SEV_OPTS = ['all', 'critical', 'high', 'medium', 'low'] as const;
type SevFilter = (typeof SEV_OPTS)[number];

const STATUS_OPTS = ['all', 'new', 'acknowledged', 'in_progress', 'dismissed', 'closed'] as const;
type StatusFilter = (typeof STATUS_OPTS)[number];

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors',
        active
          ? 'border-[var(--cy-1)] bg-[var(--cy-3)] text-[var(--cy-fg)]'
          : 'border-[var(--line-2)] bg-[var(--bg-3)] text-muted-foreground hover:border-[var(--line-3)] hover:text-foreground',
      )}
      data-testid={`alerts-chip-${label.toLowerCase()}`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function timeAgo(ts: string | null | undefined): string {
  if (!ts) return '—';
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Page ──────────────────────────────────────────────────────────────

function AlertsSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="alerts-loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[60px]" />
      ))}
    </div>
  );
}

function AlertsEmpty() {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-card px-6 py-6 text-center text-muted-foreground"
      data-testid="alerts-empty"
    >
      <p className="font-mono uppercase tracking-[0.08em] text-xs text-[var(--fg-2)] mb-1">
        No findings match the current filters
      </p>
      <p className="text-[13px] text-[var(--fg-3)]">
        Adjust severity / triage status above, or load demo data via{' '}
        <Link to="/react/onboarding" className="text-[var(--cy-2)] hover:underline">
          onboarding
        </Link>{' '}
        to see findings populated.
      </p>
    </div>
  );
}

interface FindingRowProps {
  finding: FindingRecord;
  scope: string;
  onOpen: () => void;
}

function FindingRow({ finding, scope, onOpen }: FindingRowProps) {
  const meta = parseFindingMeta(finding);
  const target = (meta.target as string) || (meta.host as string) || '—';
  const status = finding.triage_status || (finding.status as FindingTriageStatus) || 'new';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-finding-id={finding.id}
      data-testid="alerts-row"
      className="w-full text-left rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-[var(--cy-2)] hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <span className="font-mono text-[10px] text-muted-foreground">
          {finding.id.slice(0, 8)}
        </span>
        <span className="truncate text-sm text-foreground font-semibold">
          {finding.title || '(untitled)'}
        </span>
        <Badge variant="outline" className="ml-auto text-[10px]">
          {status}
        </Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px] text-muted-foreground">
        <span>{target}</span>
        <span>scope: {scope}</span>
        <span className="ml-auto">{timeAgo(finding.first_seen_at || finding.last_seen_at)} ago</span>
      </div>
    </button>
  );
}

export function AlertsPage() {
  const navigate = useNavigate();
  const [sev, setSev] = useState<SevFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Scope filter is derived from the loaded data; chips toggle by name.
  const [scopeFilter, setScopeFilter] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useFindings({});
  const findings = data ?? [];

  // Derive a set of scope labels present in the loaded data. The /api/
  // findings rows don't include a scope name directly — we surface the
  // raw assetId as a stand-in when no metadata.scope_name is present.
  const scopeOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const f of findings) {
      const meta = parseFindingMeta(f);
      const label =
        (meta.scope_name as string)
        || (meta.scopeName as string)
        || (typeof f.assetId === 'string' ? `asset:${f.assetId.slice(0, 8)}` : null);
      if (label) labels.add(label);
    }
    return Array.from(labels).slice(0, 8);
  }, [findings]);

  const filtered = useMemo(() => {
    const minRank = sev === 'all' ? 0 : severityRank(sev);
    return findings
      .filter((f) => {
        if (severityRank(f.severity) < minRank) return false;
        if (sev !== 'all' && severityRank(f.severity) !== severityRank(sev)) {
          // Loose match: only exact severity tier when the chip is set.
          // Falls through `all` for permissive view.
          return false;
        }
        if (statusFilter !== 'all') {
          const st = f.triage_status || f.status;
          if (st !== statusFilter) return false;
        }
        if (scopeFilter) {
          const meta = parseFindingMeta(f);
          const label =
            (meta.scope_name as string)
            || (meta.scopeName as string)
            || (typeof f.assetId === 'string' ? `asset:${f.assetId.slice(0, 8)}` : null);
          if (label !== scopeFilter) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ra = severityRank(a.severity);
        const rb = severityRank(b.severity);
        if (rb !== ra) return rb - ra;
        const ta = a.first_seen_at ? Date.parse(a.first_seen_at) : 0;
        const tb = b.first_seen_at ? Date.parse(b.first_seen_at) : 0;
        return tb - ta;
      });
  }, [findings, sev, statusFilter, scopeFilter]);

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        <header className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
              Triage queue
            </p>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Alerts</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Every finding lands here. Filter by severity or triage status, then
              ack / progress / dismiss / close from the drawer. High and critical
              dismissals require a note for the audit trail.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="refresh-alerts-btn"
            >
              ↻ Refresh
            </Button>
          </div>
        </header>

        <section
          aria-label="Filters"
          data-testid="alerts-filters"
          className="rounded-md border border-border bg-[var(--bg-1)] px-3 py-2 mb-3 space-y-2"
        >
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground mr-2">
              Severity:
            </span>
            {SEV_OPTS.map((s) => (
              <FilterChip
                key={s}
                label={s}
                active={sev === s}
                onClick={() => setSev(s)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground mr-2">
              Status:
            </span>
            {STATUS_OPTS.map((s) => (
              <FilterChip
                key={s}
                label={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
              />
            ))}
          </div>
          {scopeOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground mr-2">
                Scope:
              </span>
              <FilterChip
                label="all"
                active={!scopeFilter}
                onClick={() => setScopeFilter(null)}
              />
              {scopeOptions.map((s) => (
                <FilterChip
                  key={s}
                  label={s}
                  active={scopeFilter === s}
                  onClick={() => setScopeFilter(s)}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section aria-label="Findings list" className="py-1">
          {isLoading ? (
            <AlertsSkeleton />
          ) : isError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              Failed to load findings: {(error as Error)?.message ?? 'unknown error'}
            </div>
          ) : filtered.length === 0 ? (
            <AlertsEmpty />
          ) : (
            <ul
              className="flex flex-col gap-1.5 list-none m-0 p-0"
              data-testid="alerts-list"
            >
              {filtered.map((f) => {
                const meta = parseFindingMeta(f);
                const scope =
                  (meta.scope_name as string)
                  || (meta.scopeName as string)
                  || (typeof f.assetId === 'string' ? `asset:${f.assetId.slice(0, 8)}` : '—');
                return (
                  <li key={f.id}>
                    <FindingRow
                      finding={f}
                      scope={scope}
                      onOpen={() => navigate(`/react/alerts/${f.id}`)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Outlet />
      </div>
    </main>
  );
}

// ── Detail Sheet ─────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="px-4 py-6 space-y-3" data-testid="alert-detail-loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function AlertDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Read the cached list and find by id. /api/findings/:id isn't a
  // first-class GET — the list itself is the source of truth.
  const { data: findings, isLoading, isError, error } = useFindings({});
  const finding = (findings ?? []).find((f) => f.id === id) || null;

  const triage = useTriage(id);

  useEffect(() => {
    if (!open) navigate('/react/alerts', { replace: true });
  }, [open, navigate]);

  async function handleTriage(triageStatus: FindingTriageStatus, dismissalNote: string | null) {
    setFeedback(null);
    try {
      await triage.mutateAsync({ triageStatus, dismissalNote });
      setFeedback({ kind: 'ok', text: `✓ Marked ${triageStatus}.` });
      if (triageStatus === 'dismissed' || triageStatus === 'closed') {
        setTimeout(() => setOpen(false), 600);
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const text =
        e.code === 'dismissal_note_required' || /dismissal_note_required/.test(e.message || '')
          ? '✗ A dismissal note is required for high/critical findings.'
          : `✗ ${e.message || 'triage failed'}`;
      setFeedback({ kind: 'err', text });
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" data-testid="alert-detail-sheet">
        {isLoading ? (
          <DetailSkeleton />
        ) : isError || !finding ? (
          <SheetHeader>
            <SheetTitle>Failed to load</SheetTitle>
            <SheetDescription>
              {(error as Error)?.message ?? 'Finding not found.'}
            </SheetDescription>
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <SeverityBadge severity={finding.severity} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {finding.id.slice(0, 12)}
                </span>
                <Badge variant="outline">
                  {finding.triage_status || finding.status || 'new'}
                </Badge>
              </div>
              <SheetTitle>{finding.title || '(untitled)'}</SheetTitle>
              <SheetDescription>
                {finding.first_seen_at
                  ? `First seen ${finding.first_seen_at}`
                  : 'No first-seen timestamp'}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {finding.description ? (
                <section>
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground mb-1">
                    Description
                  </h3>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {finding.description}
                  </p>
                </section>
              ) : null}
              {finding.recommendation ? (
                <section>
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground mb-1">
                    Recommendation
                  </h3>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {finding.recommendation}
                  </p>
                </section>
              ) : null}
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground mb-1">
                  Source
                </h3>
                <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-[12px]">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground self-center">
                    Run
                  </dt>
                  <dd className="font-mono text-[11px]">
                    {finding.runId ? (
                      <Link
                        to={`/react/runs/${finding.runId}`}
                        className="text-[var(--cy-2)] hover:underline"
                      >
                        {finding.runId.slice(0, 12)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </dd>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground self-center">
                    Asset
                  </dt>
                  <dd className="font-mono text-[11px]">
                    {finding.assetId ? finding.assetId.slice(0, 12) : '—'}
                  </dd>
                </dl>
              </section>
              {finding.evidence ? (
                <details className="rounded-md border border-border bg-[var(--bg-1)] px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-foreground">
                    Evidence
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-[var(--fg-2)]">
                    {typeof finding.evidence === 'string'
                      ? finding.evidence
                      : JSON.stringify(finding.evidence, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>

            <div className="border-t border-border px-4 py-3 space-y-2">
              {feedback ? (
                <p
                  role="status"
                  className={
                    feedback.kind === 'ok'
                      ? 'text-xs text-[#66c293]'
                      : 'text-xs text-destructive'
                  }
                >
                  {feedback.text}
                </p>
              ) : null}
              <TriageRail
                finding={finding}
                onTriage={handleTriage}
                disabled={triage.isPending}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default AlertsPage;
