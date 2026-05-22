// Alerts — triage queue for findings. Filter chips by severity +
// triage status; clicking a row opens a persistent INLINE detail panel
// beside the list (master-detail SplitPane) with the full finding detail
// + a 4-button TriageRail at the bottom.
//
// Mirrors the legacy frontend/js/pages/alerts-page.js contract:
//   - GET /api/findings
//   - PATCH /api/findings/:id/triage with { triageStatus, dismissalNote }
//   - HTTP 400 + code dismissal_note_required for high|crit dismissal
//
// This page now serves the bare /alerts path (post-A8.5 cutover).

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link, Outlet, useMatch, useNavigate, useParams } from 'react-router-dom';

import { ListRow } from '@/components/ListRow';
import { SeverityBadge } from '@/components/SeverityBadge';
import { TriageRail } from '@/components/TriageRail';
import { PageHeader } from '@/components/PageHeader';
import { Kv, SevTick, type Severity } from '@/components/ui/kit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IcX } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { SplitPane } from '@/components/ui/split-pane';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { severityClass } from '@/lib/findings';
import {
  exportFindings,
  useAsset,
  type ExportFormat,
} from '@/lib/alerts-export';
import {
  parseFindingMeta,
  severityRank,
  useFindingHistory,
  useFindings,
  useTriage,
} from '@/lib/findings';
import { useRunEvents } from '@/lib/runs';
import type {
  FindingHistoryEvent,
  FindingRecord,
  FindingTriageStatus,
  TraceEvent,
} from '@/lib/types';

// ── Filters ───────────────────────────────────────────────────────────

const SEV_OPTS = ['all', 'critical', 'high', 'medium', 'low'] as const;
type SevFilter = (typeof SEV_OPTS)[number];

const STATUS_OPTS = ['all', 'new', 'acknowledged', 'in_progress', 'dismissed', 'closed'] as const;
type StatusFilter = (typeof STATUS_OPTS)[number];

const VIEW_OPTS = ['queue', 'grid', 'map'] as const;
type ViewMode = (typeof VIEW_OPTS)[number];

// Derives the scope/host grouping label for a finding. Shared by the
// scope filter chips and the clustered "Map" view.
function scopeLabel(f: FindingRecord): string {
  const meta = parseFindingMeta(f);
  return (
    (meta.scope_name as string)
    || (meta.scopeName as string)
    || (typeof f.assetId === 'string' ? `asset:${f.assetId.slice(0, 8)}` : '—')
  );
}

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

// Triage status → color token. Untriaged ("new") reads crit, active work
// reads high, resolved states fall to muted — mirrors the kit's status cell.
function statusColor(status: string): string {
  if (status === 'new') return 'var(--sev-crit)';
  if (status === 'in_progress' || status === 'acknowledged') return 'var(--sev-high)';
  return 'var(--fg-3)';
}

// Pull the kit's per-row columns out of a finding's metadata, gracefully
// degrading to the raw record fields when the optional meta keys are absent.
interface FindingCols {
  status: FindingTriageStatus;
  asset: string;
  rule: string;
  hostPort: string;
  cve: string;
}

function findingCols(finding: FindingRecord): FindingCols {
  const meta = parseFindingMeta(finding);
  const status =
    finding.triage_status || (finding.status as FindingTriageStatus) || 'new';
  const host = (meta.host as string) || (meta.target as string) || '';
  const port = meta.port != null ? String(meta.port) : '';
  const hostPort = host ? (port && port !== '—' ? `${host}:${port}` : host) : '—';
  return {
    status,
    asset:
      (meta.asset as string)
      || (finding.assetId ? finding.assetId.slice(0, 8) : '—'),
    rule:
      (meta.rule as string)
      || (meta.detector as string)
      || '—',
    hostPort,
    cve: (meta.cve as string) || (meta.cwe as string) || '',
  };
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
        <Link to="/onboarding" className="text-[var(--cy-2)] hover:underline">
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
    <ListRow
      onClick={onOpen}
      data-finding-id={finding.id}
      data-testid="alerts-row"
      className="px-3 py-2"
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
    </ListRow>
  );
}

// Dense `.tbl` row — the kit's alert-queue anatomy: sev-tick · mono-cyan
// ID · severity badge · finding · asset · rule · host:port · status · age
// · hover-revealed row actions. Selected row gets the cyan inset.
interface FindingTableRowProps {
  finding: FindingRecord;
  selected: boolean;
  onOpen: () => void;
}

function FindingTableRow({ finding, selected, onOpen }: FindingTableRowProps) {
  const cols = findingCols(finding);
  const sev = severityClass(finding.severity) as Severity;
  return (
    <tr
      className={selected ? 'selected' : undefined}
      onClick={onOpen}
      data-finding-id={finding.id}
      data-testid="alerts-row"
      style={{ cursor: 'pointer' }}
    >
      <td style={{ padding: 0 }}>
        <SevTick s={sev} />
      </td>
      <td className="mono">
        <span style={{ color: 'var(--cy-1)' }}>{finding.id.slice(0, 8)}</span>
      </td>
      <td>
        <SeverityBadge severity={finding.severity} />
      </td>
      <td>
        <span className="truncate-1" style={{ display: 'inline-block', maxWidth: 320 }}>
          {finding.title || '(untitled)'}
        </span>
      </td>
      <td className="mono muted">{cols.asset}</td>
      <td className="mono muted">{cols.rule}</td>
      <td className="mono muted">{cols.hostPort}</td>
      <td>
        <span className="caption" style={{ color: statusColor(cols.status) }}>
          {cols.status}
        </span>
      </td>
      <td className="ts">{timeAgo(finding.first_seen_at || finding.last_seen_at)}</td>
      <td>
        <button
          type="button"
          className="btn btn-sm btn-ghost row-actions"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={`Open finding ${finding.id.slice(0, 8)}`}
        >
          ⋯
        </button>
      </td>
    </tr>
  );
}

export function AlertsPage() {
  const navigate = useNavigate();
  const { id: selectedId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [sev, setSev] = useState<SevFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Scope filter is derived from the loaded data; chips toggle by name.
  const [scopeFilter, setScopeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('queue');

  const { data, isLoading, isError, error, refetch, isFetching } = useFindings({});
  const findings = data ?? [];

  // Derive a set of scope labels present in the loaded data. The /api/
  // findings rows don't include a scope name directly — we surface the
  // raw assetId as a stand-in when no metadata.scope_name is present.
  const scopeOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const f of findings) {
      const label = scopeLabel(f);
      if (label && label !== '—') labels.add(label);
    }
    return Array.from(labels).slice(0, 8);
  }, [findings]);

  const filtered = useMemo(() => {
    const minRank = sev === 'all' ? 0 : severityRank(sev);
    const term = search.trim().toLowerCase();
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
        if (scopeFilter && scopeLabel(f) !== scopeFilter) return false;
        if (term) {
          const meta = parseFindingMeta(f);
          const hay = [
            f.id, f.title, f.description, f.assetId, f.runId,
            meta.rule, meta.cve, meta.cwe, meta.target, meta.host, meta.detector,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(term)) return false;
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
  }, [findings, sev, statusFilter, scopeFilter, search]);

  // Group the filtered findings by scope/host for the clustered "Map"
  // view — a real map lib is out of scope, so we render labelled clusters.
  const clusters = useMemo(() => {
    const groups = new Map<string, FindingRecord[]>();
    for (const f of filtered) {
      const key = scopeLabel(f);
      const arr = groups.get(key);
      if (arr) arr.push(f);
      else groups.set(key, [f]);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  function handleExport(format: ExportFormat) {
    try {
      const n = exportFindings(filtered, format);
      toast({
        title: `Exported ${n} finding${n === 1 ? '' : 's'}`,
        description: `Downloaded as ${format.toUpperCase()}.`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: (err as Error)?.message ?? 'Could not build the export file.',
        variant: 'error',
      });
    }
  }

  function openFinding(f: FindingRecord) {
    navigate(`/alerts/${f.id}`);
  }

  // Detail is open whenever the /alerts/:id child route is active. The
  // SplitPane keeps the list visible beside the inline detail panel.
  const detailOpen = useMatch('/alerts/:id') != null;

  const listRegion = (
    <div className="px-6 py-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search findings — title, id, host, CVE…"
            aria-label="Search findings"
            data-testid="alerts-search"
            className="max-w-md"
          />
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              View:
            </span>
            <ToggleGroup
              type="single"
              size="sm"
              value={view}
              onValueChange={(v) => {
                if (v) setView(v as ViewMode);
              }}
              data-testid="alerts-view-toggle"
              aria-label="Findings view mode"
            >
              {VIEW_OPTS.map((v) => (
                <ToggleGroupItem
                  key={v}
                  value={v}
                  aria-label={`${v} view`}
                  data-testid={`alerts-view-${v}`}
                  className="capitalize"
                >
                  {v}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

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
          ) : view === 'map' ? (
            <div className="flex flex-col gap-3" data-testid="alerts-map">
              {clusters.map(([label, rows]) => (
                <section
                  key={label}
                  className="rounded-md border border-border bg-[var(--bg-1)] p-2"
                  data-testid="alerts-cluster"
                >
                  <header className="flex items-center gap-2 px-1 pb-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-foreground">
                      {label}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {rows.length}
                    </Badge>
                  </header>
                  <ul className="flex flex-col gap-1.5 list-none m-0 p-0">
                    {rows.map((f) => (
                      <li key={f.id}>
                        <FindingRow finding={f} scope={label} onOpen={() => openFinding(f)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : view === 'grid' ? (
            <ul
              className="list-none m-0 p-0 grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3"
              data-testid="alerts-list"
              data-view="grid"
            >
              {filtered.map((f) => (
                <li key={f.id}>
                  <FindingRow finding={f} scope={scopeLabel(f)} onOpen={() => openFinding(f)} />
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="rounded-md border border-border bg-[var(--bg-1)] overflow-auto"
              data-testid="alerts-list"
              data-view="queue"
            >
              <table className="tbl zebra dense">
                <thead>
                  <tr>
                    <th style={{ width: 3, padding: 0 }} aria-label="severity" />
                    <th style={{ width: 80 }}>ID</th>
                    <th style={{ width: 70 }}>SEV</th>
                    <th>FINDING</th>
                    <th style={{ width: 140 }}>ASSET</th>
                    <th style={{ width: 140 }}>RULE</th>
                    <th style={{ width: 130 }}>HOST:PORT</th>
                    <th style={{ width: 90 }}>STATUS</th>
                    <th style={{ width: 56 }}>AGE</th>
                    <th style={{ width: 32 }} aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <FindingTableRow
                      key={f.id}
                      finding={f}
                      selected={f.id === selectedId}
                      onOpen={() => openFinding(f)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
    </div>
  );

  return (
    <main className="flex h-[calc(100vh-3rem)] flex-col bg-background text-foreground font-sans">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Triage queue"
          title="Alerts"
          description="Every finding lands here. Filter by severity or triage status, then ack / progress / dismiss / close from the detail panel. High and critical dismissals require a note for the audit trail."
          actions={
            <>
              <Tooltip content="Download the currently-filtered findings as CSV">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport('csv')}
                  disabled={filtered.length === 0}
                  data-testid="export-csv-btn"
                >
                  ↓ CSV
                </Button>
              </Tooltip>
              <Tooltip content="Download the currently-filtered findings as JSON">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport('json')}
                  disabled={filtered.length === 0}
                  data-testid="export-json-btn"
                >
                  ↓ JSON
                </Button>
              </Tooltip>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                loading={isFetching}
                data-testid="refresh-alerts-btn"
              >
                ↻ Refresh
              </Button>
            </>
          }
        />
      </div>

      {/* Master-detail: the list stays visible beside the inline detail
          column (<Outlet/> → AlertDetailRoute) when /alerts/:id is active. */}
      <div className="min-h-0 flex-1">
        <SplitPane
          list={listRegion}
          detail={<Outlet />}
          detailOpen={detailOpen}
          detailWidth={420}
        />
      </div>
    </main>
  );
}

// ── Detail panel (inline) ────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="px-4 py-6 space-y-3" data-testid="alert-detail-loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// Asset tab — lazy-loads GET /api/assets/:id only once selected. The
// `useAsset` query stays disabled until `enabled` flips true (this
// component only mounts when the Asset tab is active), so we never fetch
// asset detail for findings the operator never drills into.
function AssetTab({ assetId }: { assetId: string | null }) {
  const { data: asset, isLoading, isError, error } = useAsset(assetId, true);

  if (!assetId) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="alert-asset-empty">
        No asset linked to this finding.
      </p>
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="alert-asset-loading">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (isError || !asset) {
    return (
      <p className="text-sm text-destructive" data-testid="alert-asset-error">
        Failed to load asset: {(error as Error)?.message ?? 'unknown error'}
      </p>
    );
  }

  const rows: Array<[string, string]> = [
    ['name', String(asset.name || asset.identifier || '—')],
    ['type', String(asset.type || '—')],
    ['address', String(asset.address || asset.target || '—')],
    ['criticality', String(asset.criticality || '—')],
    ['environment', String(asset.environment || '—')],
    ['scope', String(asset.scope_id || asset.scopeId || '—')],
  ];
  return (
    <dl
      className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px]"
      data-testid="alert-asset-card"
    >
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground self-center">
            {k}
          </dt>
          <dd className="font-mono text-[11px] text-foreground break-words">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

type DetailTab = 'evidence' | 'asset' | 'trace' | 'history';

// Section caption — the kit's mono uppercase label that introduces each
// drawer block (EVIDENCE / PROOF-OF-CONCEPT / POLICY DECISION / …).
function DrawerCaption({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('caption', className)}>{children}</div>;
}

// Map a history event kind to a kit `.evt` left-border color token so the
// timeline reads in the kit palette (detected=cyan, fixed=ok, triage=med).
const HISTORY_EVT_COLOR: Record<FindingHistoryEvent['kind'], string> = {
  detected: 'var(--cy-1)',
  trace: 'var(--fg-3)',
  updated: 'var(--fg-3)',
  fixed: 'var(--sev-ok)',
  triage: 'var(--sev-med)',
};

// History tab — fetches the real lifecycle from GET /api/findings/:id/history
// (server reconstructs it from the finding's timestamps + triage state +
// the originating run's trace_events). Renders the kit `.evt`/timeline.
function HistoryTab({ finding }: { finding: FindingRecord }) {
  const { data, isLoading, isError, error } = useFindingHistory(finding.id);

  return (
    <div>
      <DrawerCaption>HISTORY</DrawerCaption>
      <div className="timeline" style={{ marginTop: 10 }} data-testid="alert-history">
        {isLoading ? (
          <div className="space-y-2" data-testid="alert-history-loading">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive" data-testid="alert-history-error">
            Failed to load history: {(error as Error)?.message ?? 'unknown error'}
          </p>
        ) : !data || data.events.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="alert-history-empty">
            No history recorded.
          </p>
        ) : (
          data.events.map((e, i) => (
            <div
              className="evt"
              key={`${e.kind}-${e.seq ?? i}`}
              data-kind={e.kind}
              data-origin={e.isOrigin || undefined}
              style={{ borderLeft: `2px solid ${HISTORY_EVT_COLOR[e.kind]}` }}
            >
              <div className="hdr">
                <span className="kind">{e.kind}</span>
                <span className="name">{e.label}</span>
                <span className="ts">{e.at || '—'}</span>
              </div>
              {e.detail ? (
                <div
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2, wordBreak: 'break-word' }}
                >
                  {e.detail}
                  {e.dismissalNote ? ` · ${e.dismissalNote}` : ''}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Compact trace-event row in the kit `.evt` anatomy: kind chip · tool/type
// name · status · timestamp.
function TraceEventRow({ ev }: { ev: TraceEvent }) {
  const ok = ev.status === 'completed' || ev.status === 'ok';
  const failed = ev.status === 'failed' || ev.status === 'error';
  const cls = failed ? 'evt blocked' : ok ? 'evt ok' : 'evt';
  const preview = ev.output_preview || ev.outputPreview || '';
  return (
    <div className={cls} data-event-type={ev.type} data-seq={ev.seq}>
      <div className="hdr">
        <span className="kind">{ev.phase || ev.type.split('.')[0]}</span>
        <span className="name">{ev.tool_name || ev.type}</span>
        {ev.status ? <span className="caption">· {ev.status}</span> : null}
        <span className="ts">{ev.started_at || ev.created_at || ''}</span>
      </div>
      {preview ? (
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2, wordBreak: 'break-word' }}
        >
          {preview.length > 200 ? `${preview.slice(0, 200)}…` : preview}
        </div>
      ) : null}
    </div>
  );
}

// Trace tab — fetches the originating run's events via useRunEvents
// (backed by /api/runs/:id/events) and renders them as a compact kit
// timeline. Keeps the "no run linked" empty state when runId is null.
function TraceTab({ finding }: { finding: FindingRecord }) {
  const { data: events, isLoading, isError, error } = useRunEvents(finding.runId);

  return (
    <div>
      <DrawerCaption>TRACE</DrawerCaption>
      <div style={{ marginTop: 10 }}>
        {!finding.runId ? (
          <p className="text-sm text-muted-foreground" data-testid="alert-trace-empty">
            No run linked — this finding has no recorded trace.
          </p>
        ) : isLoading ? (
          <div className="space-y-2" data-testid="alert-trace-loading">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive" data-testid="alert-trace-error">
            Failed to load trace: {(error as Error)?.message ?? 'unknown error'}
          </p>
        ) : !events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="alert-trace-empty-events">
            Run{' '}
            <Link to={`/runs/${finding.runId}`} className="link mono">
              {finding.runId.slice(0, 12)}
            </Link>{' '}
            has no recorded trace events.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground mb-2">
              {events.length} event{events.length === 1 ? '' : 's'} from run{' '}
              <Link to={`/runs/${finding.runId}`} className="link mono">
                {finding.runId.slice(0, 12)}
              </Link>
            </p>
            <div className="timeline" data-testid="alert-trace-events">
              {events.map((ev) => (
                <TraceEventRow key={ev.id} ev={ev} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface FindingDrawerProps {
  finding: FindingRecord;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  feedback: { kind: 'ok' | 'err'; text: string } | null;
  onTriage: (status: FindingTriageStatus, note: string | null) => void | Promise<void>;
  triaging: boolean;
  onClose: () => void;
}

// The detail drawer, styled to the kit's `.drawer` anatomy as a persistent
// inline column beside the list: header (sev-tick + badge + mono id +
// status + title + close), tabbed body (Evidence / Asset / Trace /
// History), footer triage rail.
function FindingDrawer({ finding, tab, onTab, feedback, onTriage, triaging, onClose }: FindingDrawerProps) {
  const sev = severityClass(finding.severity) as Severity;
  const cols = findingCols(finding);
  const meta = parseFindingMeta(finding);
  const status = cols.status;

  // PoC: real finding.evidence first (string or serialized blob), then the
  // metadata.poc/proof fallbacks, else the graceful empty state.
  const poc =
    (typeof finding.evidence === 'string' && finding.evidence)
    || (finding.evidence ? JSON.stringify(finding.evidence, null, 2) : '')
    || (meta.poc as string)
    || (meta.proof as string)
    || '';

  // Suggested fix: real finding.recommendation first, then a structured list
  // in metadata, else nothing.
  const fixes: string[] = finding.recommendation
    ? [finding.recommendation]
    : Array.isArray(meta.remediation)
      ? (meta.remediation as string[])
      : Array.isArray(meta.fixes)
        ? (meta.fixes as string[])
        : [];

  // Policy decision: an explicit metadata.policy_decision wins; otherwise we
  // name the governing scope from the finding's real scopeId, falling back to
  // a metadata scope name, then the graceful "no decision recorded" text.
  const policy = (meta.policy_decision as string) || (meta.policyDecision as string) || '';
  const scope =
    finding.scopeId
    || (meta.scope_name as string)
    || (meta.scopeName as string)
    || '';

  return (
    <div className="drawer" data-testid="alert-drawer" style={{ height: '100%' }}>
      <div className="drawer-hd">
        <SevTick s={sev} />
        <div className="grow">
          <div className="kit-row" style={{ gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
            <SeverityBadge severity={finding.severity} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-mono-ts)' }}>
              {finding.id.slice(0, 12)}
            </span>
            <span className="caption" style={{ color: statusColor(status) }}>
              · {status}
            </span>
          </div>
          <div className="title">{finding.title || '(untitled)'}</div>
          <div className="sub mono" style={{ fontSize: 11 }}>
            {[cols.cve, cols.rule !== '—' ? `via ${cols.rule}` : '']
              .filter(Boolean)
              .join(' · ') || 'No detector metadata'}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost shrink-0"
          onClick={onClose}
          aria-label="Close finding detail"
          data-testid="alert-detail-close"
        >
          <IcX />
        </button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => onTab(v as DetailTab)}
        className="drawer-bd flex flex-col min-h-0"
      >
        <TabsList className="tabs shrink-0" data-testid="alert-detail-tabs">
          <TabsTrigger className="tab" value="evidence" data-testid="alert-tab-evidence">
            Evidence
          </TabsTrigger>
          <TabsTrigger className="tab" value="asset" data-testid="alert-tab-asset">
            Asset
          </TabsTrigger>
          <TabsTrigger className="tab" value="trace" data-testid="alert-tab-trace">
            Trace
          </TabsTrigger>
          <TabsTrigger className="tab" value="history" data-testid="alert-tab-history">
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="evidence" className="flex-1 overflow-y-auto" style={{ padding: '14px 16px' }}>
          <DrawerCaption className="mb-1.5">EVIDENCE</DrawerCaption>
          <Kv
            items={[
              { k: 'asset', v: cols.asset },
              { k: 'host:port', v: cols.hostPort },
              { k: 'cwe / cve', v: cols.cve || '—' },
              { k: 'detector', v: cols.rule },
              {
                k: 'run',
                v: finding.runId ? (
                  <Link to={`/runs/${finding.runId}`} className="link">
                    {finding.runId.slice(0, 12)}
                  </Link>
                ) : (
                  '—'
                ),
              },
              { k: 'first seen', v: finding.first_seen_at || '—' },
            ]}
          />

          <DrawerCaption className="mt-[18px] mb-1.5">PROOF-OF-CONCEPT</DrawerCaption>
          {poc ? (
            <pre
              data-testid="alert-poc"
              style={{
                background: 'var(--bg-1)',
                border: '1px solid var(--line-1)',
                borderLeft: '2px solid var(--sev-crit)',
                borderRadius: 'var(--r-3)',
                padding: '10px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--fg-1)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                lineHeight: 1.55,
                maxHeight: 220,
                overflow: 'auto',
              }}
            >
              {poc}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="alert-poc-empty">
              No PoC recorded for this finding.
            </p>
          )}

          <DrawerCaption className="mt-[18px] mb-1.5">POLICY DECISION</DrawerCaption>
          <div
            className="panel"
            style={{ background: 'var(--policy-bg)', borderColor: 'var(--policy-line)' }}
            data-testid="alert-policy"
          >
            <div className="panel-bd" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ color: 'var(--policy)', marginTop: 2 }}>⛒</span>
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg-1)', fontWeight: 500 }}>
                  {policy ? 'Policy applied' : 'No policy intervention'}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 4 }}>
                  {policy
                    || (scope
                      ? `Discovered under scope ${scope}; no exploit step was blocked.`
                      : 'No policy decision recorded for this finding.')}
                </div>
              </div>
            </div>
          </div>

          <DrawerCaption className="mt-[18px] mb-1.5">SUGGESTED FIX</DrawerCaption>
          {fixes.length > 0 ? (
            <ul
              data-testid="alert-fixes"
              style={{ paddingLeft: 18, color: 'var(--fg-2)', fontSize: 12, lineHeight: 1.7 }}
            >
              {fixes.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="alert-fixes-empty">
              No remediation guidance recorded.
            </p>
          )}

          {finding.description ? (
            <>
              <DrawerCaption className="mt-[18px] mb-1.5">DESCRIPTION</DrawerCaption>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {finding.description}
              </p>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="asset" className="flex-1 overflow-y-auto" style={{ padding: '14px 16px' }}>
          {/* Mounted only here; the AssetTab fetch fires lazily on first
              selection and is cached by React Query after. */}
          {tab === 'asset' ? <AssetTab assetId={finding.assetId} /> : null}
        </TabsContent>

        <TabsContent value="trace" className="flex-1 overflow-y-auto" style={{ padding: '14px 16px' }}>
          <TraceTab finding={finding} />
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-y-auto" style={{ padding: '14px 16px' }}>
          <HistoryTab finding={finding} />
        </TabsContent>
      </Tabs>

      <div className="drawer-ft" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        {feedback ? (
          <p
            role="status"
            className={feedback.kind === 'ok' ? 'text-xs text-[var(--ok-2)]' : 'text-xs text-destructive'}
          >
            {feedback.text}
          </p>
        ) : null}
        <TriageRail finding={finding} onTriage={onTriage} disabled={triaging} />
      </div>
    </div>
  );
}

export function AlertDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>('evidence');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Read the cached list and find by id. /api/findings/:id isn't a
  // first-class GET — the list itself is the source of truth.
  const { data: findings, isLoading, isError, error } = useFindings({});
  const finding = (findings ?? []).find((f) => f.id === id) || null;

  const triage = useTriage(id);

  function close() {
    navigate('/alerts', { replace: true });
  }

  async function handleTriage(triageStatus: FindingTriageStatus, dismissalNote: string | null) {
    setFeedback(null);
    try {
      await triage.mutateAsync({ triageStatus, dismissalNote });
      setFeedback({ kind: 'ok', text: `✓ Marked ${triageStatus}.` });
      if (triageStatus === 'dismissed' || triageStatus === 'closed') {
        setTimeout(() => close(), 600);
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

  // Inline detail panel — rendered into the SplitPane's detail column, so
  // the list stays visible beside it on desktop (master-detail).
  if (isLoading) {
    return (
      <div className="drawer h-full" data-testid="alert-detail-panel">
        <DetailSkeleton />
      </div>
    );
  }
  if (isError || !finding) {
    return (
      <div className="drawer h-full" data-testid="alert-detail-panel">
        <div className="drawer-hd">
          <div className="grow">
            <div className="title">Failed to load</div>
            <div className="sub mono" style={{ fontSize: 11 }}>
              {(error as Error)?.message ?? 'Finding not found.'}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost shrink-0"
            onClick={close}
            aria-label="Close finding detail"
            data-testid="alert-detail-close"
          >
            <IcX />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="h-full" data-testid="alert-detail-panel">
      <FindingDrawer
        finding={finding}
        tab={tab}
        onTab={setTab}
        feedback={feedback}
        onTriage={handleTriage}
        triaging={triage.isPending}
        onClose={close}
      />
    </div>
  );
}

export default AlertsPage;
