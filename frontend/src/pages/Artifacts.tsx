// Artifacts — list view of every artifact stored by PHANTOM. React
// translation of frontend/js/pages/artifacts-page.js list view (the
// preview pane stays on the legacy /artifacts page for now).
//
// The filter chip row groups artifact `type` values into five
// operator-friendly buckets (All / Reports / Evidence / Trace / Other)
// per the mega-plan ask. Filtering is client-side so chip toggling
// feels instant — the list fetches once with limit=100 and slices
// locally; that mirrors what the legacy page does (it does
// server-side type filtering, but the difference is invisible at the
// 100-row default cap).

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ARTIFACT_FILTERS, matchesArtifactFilter, useArtifacts } from '@/lib/artifacts';
import type { ArtifactFilter, ArtifactRecord } from '@/lib/types';
import { cn } from '@/lib/utils';

function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = (Date.now() - t) / 60000;
  if (mins < 0 || !Number.isFinite(mins)) return '—';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function ArtifactsSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="artifacts-loading">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function ArtifactsEmpty({ filtered }: { filtered: boolean }) {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-card px-6 py-6 text-center text-muted-foreground"
      data-testid={filtered ? 'artifacts-empty-filtered' : 'artifacts-empty'}
    >
      <p className="font-mono uppercase tracking-[0.08em] text-xs text-[var(--fg-2)] mb-1">
        {filtered ? 'No artifacts match this filter' : 'No artifacts yet'}
      </p>
      <p className="text-[13px] text-[var(--fg-3)]">
        {filtered
          ? 'Try another chip or switch back to All.'
          : 'Run outputs, previews, and evidence bundles will appear here.'}
      </p>
    </div>
  );
}

function ArtifactsTable({ artifacts }: { artifacts: ArtifactRecord[] }) {
  return (
    <table className="w-full text-[12px]" data-testid="artifacts-table">
      <thead>
        <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          <th className="py-2 pr-3">ID</th>
          <th className="py-2 pr-3">Type</th>
          <th className="py-2 pr-3">Title</th>
          <th className="py-2 pr-3">Run</th>
          <th className="py-2">Created</th>
        </tr>
      </thead>
      <tbody>
        {artifacts.map((a) => (
          <tr
            key={a.id}
            className="border-b border-border/60 hover:bg-[var(--bg-3)]"
            data-artifact-id={a.id}
            data-artifact-type={a.type || ''}
          >
            <td className="py-2 pr-3">
              <span className="font-mono text-[11px] text-[var(--fg-2)]">
                {a.id.slice(0, 8)}
              </span>
            </td>
            <td className="py-2 pr-3">
              <Badge variant="outline" className="font-mono">
                {a.type || 'artifact'}
              </Badge>
            </td>
            <td className="py-2 pr-3 text-foreground">
              <a
                href={a.contentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {a.title || '(untitled)'}
              </a>
            </td>
            <td className="py-2 pr-3">
              {a.runId ? (
                <Link
                  to={`/react/runs/${a.runId}`}
                  className="font-mono text-[11px] text-[var(--cy-2)] hover:underline"
                >
                  {a.runId.slice(0, 8)}
                </Link>
              ) : (
                <span className="font-mono text-[11px] text-muted-foreground">—</span>
              )}
            </td>
            <td className="py-2 font-mono text-[11px] text-muted-foreground">
              {ago(a.createdAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilterChips({
  filter,
  setFilter,
  counts,
}: {
  filter: ArtifactFilter;
  setFilter: (f: ArtifactFilter) => void;
  counts: Record<ArtifactFilter, number>;
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="artifacts-filter-chips"
      role="group"
      aria-label="Artifact filters"
    >
      {ARTIFACT_FILTERS.map((f) => {
        const active = filter === f.id;
        return (
          <button
            key={f.id}
            type="button"
            data-artifact-filter={f.id}
            aria-pressed={active}
            onClick={() => setFilter(f.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors',
              active
                ? 'border-[var(--cy-2)] bg-[var(--cy-3)] text-[var(--cy-fg)]'
                : 'border-[var(--line-2)] bg-[var(--bg-3)] text-[var(--fg-2)] hover:border-[var(--cy-2)]',
            )}
          >
            <span>{f.label}</span>
            <span className="text-[10px] opacity-70">{counts[f.id]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ArtifactsPage() {
  const [filter, setFilter] = useState<ArtifactFilter>('all');
  const { data, isLoading, isError, error, refetch, isFetching } = useArtifacts();
  const list = data ?? [];

  const counts = useMemo(() => {
    const out: Record<ArtifactFilter, number> = {
      all: list.length,
      reports: 0,
      evidence: 0,
      trace: 0,
      other: 0,
    };
    for (const a of list) {
      for (const f of ARTIFACT_FILTERS) {
        if (f.id === 'all') continue;
        if (matchesArtifactFilter(a, f.id)) out[f.id] += 1;
      }
    }
    return out;
  }, [list]);

  const filtered = useMemo(
    () => list.filter((a) => matchesArtifactFilter(a, filter)),
    [list, filter],
  );

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        <header className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
              Run outputs, evidence bundles, previews
            </p>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Artifacts</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Every report, evidence bundle, graph snapshot, and preview that PHANTOM
              generates lands here. Use the filter chips to focus on a specific
              bucket; the legacy <code className="font-mono">/artifacts</code> page
              still hosts the inline preview pane.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="refresh-artifacts-btn"
            >
              ↻ Refresh
            </Button>
          </div>
        </header>

        <section className="mb-4">
          <FilterChips filter={filter} setFilter={setFilter} counts={counts} />
        </section>

        <section aria-label="Artifact list" data-empty={filtered.length === 0}>
          {isLoading ? (
            <ArtifactsSkeleton />
          ) : isError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              Failed to load artifacts: {(error as Error)?.message ?? 'unknown error'}
            </div>
          ) : list.length === 0 ? (
            <ArtifactsEmpty filtered={false} />
          ) : filtered.length === 0 ? (
            <ArtifactsEmpty filtered={true} />
          ) : (
            <div className="rounded-md border border-border bg-card">
              <ArtifactsTable artifacts={filtered} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default ArtifactsPage;
