// Runs — list + detail (Sheet) surface. React translation of the
// legacy frontend/js/pages/runs-page.js chrome.
//
// Layout mirrors CampaignsPage: a recents list on the left, with a
// Sheet drawer that slides in from the right when the operator clicks
// a row (mounted via the /react/runs/:id nested route). The legacy
// /runs page stays untouched until A8.5 deletes the vanilla bundle.
//
// Defers a few legacy responsibilities to follow-up phases:
//   - Replay scrubber UI                — A8.5
//   - Live SSE refresh                  — A8.5 (Sheet still re-reads on
//                                          query invalidation)
//   - Messages reconstruction           — A8.5 (Trace tab renders the
//                                          raw event timeline instead)

import { useState, useEffect } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RunPill } from '@/components/RunPill';
import { TraceTimeline } from '@/components/TraceTimeline';
import {
  useRun,
  useRunEvents,
  useRunEvidence,
  useRuns,
  useExportEvidence,
} from '@/lib/runs';
import type {
  ArtifactRecord,
  EvidenceBundle,
  EvidenceFinding,
  RunRecord,
} from '@/lib/types';

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

// ── List ──────────────────────────────────────────────────────────────

function RunRow({ run }: { run: RunRecord }) {
  const title = run.title || run.goal || 'Untitled run';
  return (
    <li>
      <Link
        to={`/react/runs/${run.id}`}
        data-run-id={run.id}
        className="block rounded-md border border-border bg-card px-3.5 py-3 transition-colors hover:border-[var(--cy-2)] hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        aria-label={`Open ${title}`}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <RunPill status={run.status} />
          <span className="font-semibold text-foreground truncate">{title}</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {ago(run.started_at)}
          </span>
        </div>
        <div className="flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
          <span>{run.model || 'model unknown'}</span>
          <span>{run.scope?.name || 'no scope'}</span>
          <span className="truncate">{run.id.slice(0, 8)}</span>
        </div>
      </Link>
    </li>
  );
}

function RunListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="runs-loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[72px]" />
      ))}
    </div>
  );
}

function RunsEmpty() {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-card px-6 py-6 text-center text-muted-foreground"
      data-testid="runs-empty"
    >
      <p className="font-mono uppercase tracking-[0.08em] text-xs text-[var(--fg-2)] mb-1">
        No runs yet
      </p>
      <p className="text-[13px] text-[var(--fg-3)]">
        Every chat turn that calls a tool becomes a run. Start a new chat or open
        onboarding to spin one up.
      </p>
    </div>
  );
}

export function RunsPage() {
  const navigate = useNavigate();
  const { data: runs, isLoading, isError, error, refetch, isFetching } = useRuns();
  const list = runs ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        <header className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
              Forensic lens on every tool-using chat turn
            </p>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Runs</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Each run captures the goal, model route, scope, full trace, and
              artifacts. Click a row to inspect synthesis, trace, artifacts, or
              the redacted evidence bundle.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="refresh-runs-btn"
            >
              ↻ Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/react/graph')}
              data-testid="open-graph-btn"
            >
              Open graph
            </Button>
          </div>
        </header>

        <section aria-label="Run list" data-empty={list.length === 0} className="py-4">
          {isLoading ? (
            <RunListSkeleton />
          ) : isError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              Failed to load runs: {(error as Error)?.message ?? 'unknown error'}
            </div>
          ) : list.length === 0 ? (
            <RunsEmpty />
          ) : (
            <ul className="flex flex-col gap-2 list-none m-0 p-0" data-testid="runs-list">
              {list.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            </ul>
          )}
        </section>

        {/* Mounts the detail Sheet via the nested route. */}
        <Outlet />
      </div>
    </main>
  );
}

// ── Detail Sheet (mounted at /react/runs/:id) ─────────────────────────

function SynthesisPane({ run }: { run: RunRecord }) {
  return (
    <div className="space-y-3 py-3">
      <dl className="grid grid-cols-[110px_1fr] gap-x-3.5 gap-y-1.5 text-[12px]">
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Goal
        </dt>
        <dd className="text-foreground break-words">{run.goal || '—'}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Status
        </dt>
        <dd>
          <RunPill status={run.status} />
        </dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Model
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{run.model || '—'}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Route
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{run.provider_route || '—'}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Scope
        </dt>
        <dd className="text-foreground">{run.scope?.name || 'no scope'}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Started
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{run.started_at || '—'}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Ended
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{run.ended_at || '—'}</dd>
      </dl>
      {run.summary ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-foreground whitespace-pre-wrap break-words">
              {run.summary}
            </p>
          </CardContent>
        </Card>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          No summary recorded yet. Legacy <code className="font-mono">/runs</code>{' '}
          hosts the full LLM-enriched synthesis card; this preview surfaces the
          stored summary only.
        </p>
      )}
    </div>
  );
}

function TracePane({ runId }: { runId: string }) {
  const { data: events, isLoading, isError, error } = useRunEvents(runId);
  if (isLoading) {
    return (
      <div className="space-y-2 py-3" data-testid="trace-loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load trace: {(error as Error)?.message ?? 'unknown error'}
      </div>
    );
  }
  return <TraceTimeline events={events ?? []} />;
}

function ArtifactsPane({ artifacts }: { artifacts: ArtifactRecord[] }) {
  if (!artifacts.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-4 text-sm text-muted-foreground">
        No artifacts captured for this run yet.
      </div>
    );
  }
  return (
    <ul className="space-y-2 list-none m-0 p-0" data-testid="run-artifacts-list">
      {artifacts.map((a) => (
        <li
          key={a.id}
          className="rounded-md border border-border bg-card px-3 py-2"
          data-artifact-id={a.id}
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {a.type || 'artifact'}
            </Badge>
            <span className="text-sm font-semibold text-foreground truncate">
              {a.title || a.id.slice(0, 12)}
            </span>
            <a
              href={a.contentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto font-mono text-[11px] text-[var(--cy-2)] hover:underline"
            >
              open ↗
            </a>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px] text-muted-foreground">
            <span>{a.mimeType || '—'}</span>
            <span>{a.createdAt || '—'}</span>
            <span>{a.id.slice(0, 8)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EvidenceKpi({ label, value, status }: { label: string; value: number; status: 'ok' | 'warn' | 'crit' | 'high' | 'neutral' }) {
  const color =
    status === 'crit'
      ? 'text-destructive'
      : status === 'warn'
      ? 'text-[#d8b15a]'
      : status === 'high'
      ? 'text-[#d8b15a]'
      : status === 'ok'
      ? 'text-[#66c293]'
      : 'text-[var(--cy-1)]';
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border bg-[var(--bg-3)] px-2 py-2.5">
      <span className={`font-mono text-[22px] leading-none ${color}`}>{value}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
        {label}
      </span>
    </div>
  );
}

function FindingsTable({ findings }: { findings: EvidenceFinding[] }) {
  if (!findings.length) {
    return (
      <p className="text-[12px] text-muted-foreground">No findings recorded.</p>
    );
  }
  return (
    <table className="w-full text-[12px]" data-testid="evidence-findings-table">
      <thead>
        <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          <th className="py-1.5 pr-2">Severity</th>
          <th className="py-1.5 pr-2">Title</th>
          <th className="py-1.5">Status</th>
        </tr>
      </thead>
      <tbody>
        {findings.map((f, i) => (
          <tr key={f.id ?? i} className="border-b border-border/60">
            <td className="py-1.5 pr-2 font-mono text-[11px]">{f.severity || '?'}</td>
            <td className="py-1.5 pr-2 text-foreground">{f.title || '(untitled)'}</td>
            <td className="py-1.5 font-mono text-[11px]">{f.status || '?'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface EvidencePaneProps {
  runId: string;
  bundle: EvidenceBundle | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

function EvidencePane({ runId, bundle, isLoading, isError, error }: EvidencePaneProps) {
  const exporter = useExportEvidence(runId);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2 py-3" data-testid="evidence-loading">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (isError || !bundle) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load evidence: {(error as Error)?.message ?? 'unknown error'}
      </div>
    );
  }

  const s = bundle.summary;
  const onExport = async (format: 'markdown' | 'json') => {
    setFeedback(null);
    try {
      const art = await exporter.mutateAsync(format);
      setFeedback({
        kind: 'success',
        text: `✓ exported ${art.title || art.id} (${art.id.slice(0, 8)})`,
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: `✗ ${(err as Error).message}` });
    }
  };

  return (
    <div className="space-y-4 py-3" data-testid="evidence-pane">
      <div className="grid grid-cols-5 gap-2">
        <EvidenceKpi label="Tool calls" value={s.toolCalls} status="neutral" />
        <EvidenceKpi
          label="Findings"
          value={s.findingCount}
          status={s.findingCount ? 'high' : 'ok'}
        />
        <EvidenceKpi label="Artifacts" value={s.artifactCount} status="neutral" />
        <EvidenceKpi
          label="Blocked"
          value={s.blockedCount}
          status={s.blockedCount ? 'warn' : 'ok'}
        />
        <EvidenceKpi
          label="Errors"
          value={s.errorCount}
          status={s.errorCount ? 'crit' : 'ok'}
        />
      </div>

      <details className="rounded-md border border-border bg-card px-3 py-2" open>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Scope snapshot
        </summary>
        {bundle.scope ? (
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
              Name
            </dt>
            <dd className="text-foreground">{bundle.scope.name || '(unnamed)'}</dd>
            <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
              Allowed
            </dt>
            <dd className="flex flex-wrap gap-1">
              {(bundle.scope.allowed_actions || []).length
                ? bundle.scope.allowed_actions!.map((a) => (
                    <Badge key={a} className="border-[#66c293] text-[#66c293] bg-transparent">
                      {a}
                    </Badge>
                  ))
                : '—'}
            </dd>
            <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
              Blocked
            </dt>
            <dd className="flex flex-wrap gap-1">
              {(bundle.scope.blocked_actions || []).length
                ? bundle.scope.blocked_actions!.map((a) => (
                    <Badge key={a} variant="outline" className="text-muted-foreground line-through">
                      {a}
                    </Badge>
                  ))
                : '—'}
            </dd>
            <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
              Expires
            </dt>
            <dd className="font-mono text-[11px] text-[var(--fg-2)]">
              {bundle.scope.expires_at || '—'}
            </dd>
          </dl>
        ) : (
          <p className="mt-2 text-[12px] text-muted-foreground">No scope attached.</p>
        )}
      </details>

      <details className="rounded-md border border-border bg-card px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Prompt snapshot
        </summary>
        {bundle.promptSnapshot ? (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--fg-2)]">
            {JSON.stringify(bundle.promptSnapshot, null, 2)}
          </pre>
        ) : (
          <p className="mt-2 text-[12px] text-muted-foreground">Snapshot unavailable.</p>
        )}
      </details>

      <details className="rounded-md border border-border bg-card px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Findings ({bundle.findings.length})
        </summary>
        <div className="mt-2">
          <FindingsTable findings={bundle.findings} />
        </div>
      </details>

      <details className="rounded-md border border-border bg-card px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Artifacts ({bundle.artifacts.length})
        </summary>
        <ul className="mt-2 space-y-1 list-none m-0 p-0">
          {bundle.artifacts.length === 0 ? (
            <li className="text-[12px] text-muted-foreground">No artifacts.</li>
          ) : (
            bundle.artifacts.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[12px]">
                <Badge variant="outline" className="font-mono">
                  {a.type || 'artifact'}
                </Badge>
                <span className="text-foreground truncate">{a.title || '(untitled)'}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {a.id.slice(0, 8)}
                </span>
              </li>
            ))
          )}
        </ul>
      </details>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Export the redacted evidence bundle as Markdown or JSON. Both formats
            attach to this run's artifacts and are pre-redacted on the server.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void onExport('markdown')}
              disabled={exporter.isPending}
              data-evid-action="export-md"
            >
              {exporter.isPending ? 'Exporting…' : 'Export Markdown'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onExport('json')}
              disabled={exporter.isPending}
              data-evid-action="export-json"
            >
              {exporter.isPending ? 'Exporting…' : 'Export JSON'}
            </Button>
          </div>
          {feedback ? (
            <div
              role="status"
              className={
                feedback.kind === 'success'
                  ? 'text-xs text-[#66c293]'
                  : 'text-xs text-destructive'
              }
            >
              {feedback.text}
            </div>
          ) : null}
          <p className="font-mono text-[10px] text-muted-foreground">
            generated {bundle.generatedAt} · secrets redacted
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="px-4 py-6 space-y-3" data-testid="run-detail-loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function RunDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  const { data: run, isLoading, isError, error } = useRun(id);
  const evidence = useRunEvidence(id);

  useEffect(() => {
    if (!open) {
      navigate('/react/runs', { replace: true });
    }
  }, [open, navigate]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" data-testid="run-detail-sheet">
        {isLoading ? (
          <DetailSkeleton />
        ) : isError || !run ? (
          <SheetHeader>
            <SheetTitle>Failed to load</SheetTitle>
            <SheetDescription>
              {(error as Error)?.message ?? 'Run not found.'}
            </SheetDescription>
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <RunPill status={run.status} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {run.id}
                </span>
              </div>
              <SheetTitle>{run.title || run.goal || 'Run'}</SheetTitle>
              <SheetDescription>
                {run.scope?.name || 'no scope'} · {run.model || 'model unknown'} ·{' '}
                {ago(run.started_at)}
              </SheetDescription>
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/react/graph/${run.id}`)}
                  data-run-action="graph"
                >
                  Open graph
                </Button>
              </div>
            </SheetHeader>

            <Tabs defaultValue="synthesis" className="flex-1 flex flex-col min-h-0">
              <TabsList aria-label="Run detail tabs">
                <TabsTrigger value="synthesis">Synthesis</TabsTrigger>
                <TabsTrigger value="trace">
                  Trace
                  {run.events?.length ? (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      · {run.events.length}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="artifacts">
                  Artifacts
                  {run.artifacts?.length ? (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      · {run.artifacts.length}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="evidence">Evidence</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                <TabsContent value="synthesis">
                  <SynthesisPane run={run} />
                </TabsContent>
                <TabsContent value="trace">
                  <TracePane runId={run.id} />
                </TabsContent>
                <TabsContent value="artifacts">
                  <ArtifactsPane artifacts={run.artifacts ?? []} />
                </TabsContent>
                <TabsContent value="evidence">
                  <EvidencePane
                    runId={run.id}
                    bundle={evidence.data}
                    isLoading={evidence.isLoading}
                    isError={evidence.isError}
                    error={(evidence.error as Error) ?? null}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default RunsPage;
