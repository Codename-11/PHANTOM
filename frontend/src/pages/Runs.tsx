// Runs — list + detail (Sheet) surface. React translation of the
// legacy frontend/js/pages/runs-page.js chrome.
//
// Layout mirrors CampaignsPage: a recents list on the left, with a
// Sheet drawer that slides in from the right when the operator clicks
// a row (mounted via the /runs/:id nested route).
//
// A8.5b parity-close ported the two features that previously deferred to
// legacy:
//   - Replay scrubber UI    — RunReplayScrubber over useRunEvents (Trace tab)
//   - LLM-enriched synthesis — RunSynthesisCard over GET /api/runs/:id/synthesis
//
// Still deferred:
//   - Live SSE refresh — Sheet re-reads on query invalidation only
//   - Messages reconstruction — Trace tab renders the raw event timeline

import { useState, useEffect } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
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
import { useToast } from '@/components/ui/toast';
import { ListRow } from '@/components/ListRow';
import { Kv, type KvItem } from '@/components/ui/kit';
import { RunPill } from '@/components/RunPill';
import { LoadingIcon, ScanningIcon } from '@/components/AgentStateIcon';
import { TraceTimeline } from '@/components/TraceTimeline';
import { RunReplayScrubber } from '@/components/RunReplayScrubber';
import { RunSynthesisCard } from '@/components/RunSynthesisCard';
import {
  useRun,
  useRunEvents,
  useRunEvidence,
  useRuns,
  useExportEvidence,
} from '@/lib/runs';
import { useRunSynthesis, type SynthesisNextStep } from '@/lib/runs-synthesis';
import type {
  ArtifactRecord,
  EvidenceBundle,
  EvidenceFinding,
  RunRecord,
  TraceEvent,
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
      <ListRow asChild>
        <Link
          to={`/runs/${run.id}`}
          data-run-id={run.id}
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
      </ListRow>
    </li>
  );
}

// Contextual agent-state loader. Replaces the generic Tailwind skeletons
// on agent surfaces with the ported iso animations + a status caption, so
// "the agent is working" reads as motion rather than a gray block.
function AgentLoader({
  icon,
  label,
  testid,
}: {
  icon: React.ReactNode;
  label: string;
  testid: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-10 text-center"
      data-testid={testid}
      role="status"
      aria-live="polite"
    >
      {icon}
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--fg-3)]">
        {label}
      </span>
    </div>
  );
}

function RunListSkeleton() {
  return (
    <AgentLoader
      testid="runs-loading"
      icon={<LoadingIcon size={48} />}
      label="Fetching runs…"
    />
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
        <PageHeader
          className="mb-4"
          eyebrow="Forensic lens on every tool-using chat turn"
          title="Runs"
          description="Each run captures the goal, model route, scope, full trace, and artifacts. Click a row to inspect synthesis, trace, artifacts, or the redacted evidence bundle."
          actions={
            <>
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
                onClick={() => navigate('/graph')}
                data-testid="open-graph-btn"
              >
                Open graph
              </Button>
            </>
          }
        />

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
  const navigate = useNavigate();
  const { data: synthesis, isLoading, isError, error } = useRunSynthesis(run.id);

  // Next-step actions route back to existing surfaces. Anything we can't
  // service locally falls through to the trace tab via the deep link.
  const onAction = (action: NonNullable<SynthesisNextStep['action']>) => {
    if (action === 'edit-scope') {
      navigate('/scope');
    } else if (action === 'review-trace' || action === 'review-approvals') {
      navigate(`/graph/${run.id}`);
    } else {
      navigate(`/graph/${run.id}`);
    }
  };

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

      {isLoading ? (
        <AgentLoader
          testid="synthesis-loading"
          icon={<LoadingIcon size={48} />}
          label="Building synthesis…"
        />
      ) : isError || !synthesis ? (
        <div className="space-y-2">
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            Failed to build synthesis: {(error as Error)?.message ?? 'unknown error'}
          </div>
          {run.summary ? (
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                  {run.summary}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : (
        <RunSynthesisCard synthesis={synthesis} onAction={onAction} />
      )}
    </div>
  );
}

// ── Redacted metadata snapshot ────────────────────────────────────────
//
// A persistent right-side drawer (kit `.drawer` + `.kv`) summarising the
// governed run state: RUN / SCOPE / PROMPT / ARTIFACTS. Sourced entirely
// from the run record (+ joined scope summary + redacted prompt_snapshot)
// — no new data wiring. The server already strips credential refs from
// the snapshot; we surface those as a styled `•••` redaction token.

// A masked value rendered in the governance "redacted" color.
function Redacted({ label = '•••' }: { label?: string }) {
  return (
    <span style={{ color: 'var(--redacted)', letterSpacing: '0.1em' }}>{label}</span>
  );
}

// Read a string field off the freeform prompt_snapshot blob.
function snapField(
  snap: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!snap) return null;
  for (const k of keys) {
    const v = snap[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

type RunDetail = RunRecord & { events?: TraceEvent[]; artifacts?: ArtifactRecord[] };

function RunMetadataPanel({ run }: { run: RunDetail }) {
  const snap = run.prompt_snapshot;
  const scope = run.scope;

  const runItems: KvItem[] = [
    { k: 'id', v: run.id },
    { k: 'status', v: <RunPill status={run.status} /> },
    { k: 'started', v: run.started_at || '—' },
    { k: 'toolpack', v: snapField(snap, 'toolpack', 'tool_pack') ?? '—' },
    { k: 'model', v: run.model || '—' },
  ];

  // Fragment list / redaction marker live on the (already-redacted) snapshot.
  const fragments = Array.isArray((snap as Record<string, unknown>)?.fragments)
    ? ((snap as Record<string, unknown>).fragments as unknown[]).join(' + ')
    : snapField(snap, 'fragments');
  const credentialsRedacted =
    !!snap &&
    typeof snap === 'object' &&
    !!(snap as Record<string, unknown>).scope &&
    typeof (snap as Record<string, unknown>).scope === 'object';

  const promptItems: KvItem[] = [
    { k: 'profile', v: snapField(snap, 'profile', 'profileId', 'prompt_profile_id') ?? '—' },
    { k: 'fragments', v: fragments ?? '—' },
    {
      k: 'redaction',
      v: credentialsRedacted ? (
        <span style={{ color: 'var(--sev-ok)' }}>applied</span>
      ) : (
        '—'
      ),
    },
  ];

  const artifacts = run.artifacts ?? [];

  return (
    <aside className="drawer rounded-md border border-border" data-testid="run-metadata-panel">
      <div className="drawer-hd">
        <div className="grow">
          <div className="title" style={{ fontSize: 13 }}>
            Run metadata
          </div>
          <div className="sub mono" style={{ fontSize: 11 }}>
            redacted snapshot · governed
          </div>
        </div>
      </div>
      <div className="drawer-bd" style={{ padding: '14px 16px' }}>
        <div className="caption" style={{ marginBottom: 6 }}>
          RUN
        </div>
        <Kv items={runItems} />

        <div className="caption" style={{ marginTop: 18, marginBottom: 6 }}>
          SCOPE
        </div>
        <Kv
          items={[
            { k: 'name', v: scope?.name || 'no scope' },
            {
              k: 'credentials',
              v: <Redacted />,
            },
            { k: 'expires', v: scope?.expires_at || '—' },
          ]}
        />

        <div className="caption" style={{ marginTop: 18, marginBottom: 6 }}>
          PROMPT
        </div>
        <Kv items={promptItems} />

        <div className="caption" style={{ marginTop: 18, marginBottom: 6 }}>
          ARTIFACTS
        </div>
        {artifacts.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No artifacts captured.</p>
        ) : (
          artifacts.map((a) => (
            <a
              key={a.id}
              href={a.contentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="row"
              style={{
                padding: '6px 8px',
                border: '1px solid var(--line-1)',
                borderRadius: 'var(--r-3)',
                marginBottom: 6,
                cursor: 'pointer',
                color: 'var(--fg-1)',
                textDecoration: 'none',
              }}
            >
              <span className="mono" style={{ fontSize: 12, color: 'var(--cy-1)' }}>
                {a.type || 'artifact'}
              </span>
              <span className="mono" style={{ fontSize: 12 }}>
                {a.title || a.id.slice(0, 12)}
              </span>
              <span className="grow" />
              <span className="ts">{a.id.slice(0, 8)}</span>
            </a>
          ))
        )}
      </div>
    </aside>
  );
}

function TracePane({ run }: { run: RunDetail }) {
  const runId = run.id;
  const { data: events, isLoading, isError, error } = useRunEvents(runId);
  if (isLoading) {
    return (
      <AgentLoader
        testid="trace-loading"
        icon={<ScanningIcon size={48} />}
        label="Fetching trace…"
      />
    );
  }
  if (isError) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load trace: {(error as Error)?.message ?? 'unknown error'}
      </div>
    );
  }
  const list = events ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4 min-w-0">
        <section aria-label="Replay scrubber">
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Replay
          </h3>
          <RunReplayScrubber events={list} />
        </section>
        <section aria-label="Trace timeline">
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Full timeline
          </h3>
          <TraceTimeline events={list} />
        </section>
      </div>
      <RunMetadataPanel run={run} />
    </div>
  );
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
      ? 'text-[var(--warn-2)]'
      : status === 'high'
      ? 'text-[var(--warn-2)]'
      : status === 'ok'
      ? 'text-[var(--ok-2)]'
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
  const { toast } = useToast();

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
    try {
      const art = await exporter.mutateAsync(format);
      toast({
        title: 'Evidence exported',
        description: `${art.title || art.id} (${art.id.slice(0, 8)})`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: (err as Error).message,
        variant: 'error',
      });
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
                    <Badge key={a} className="border-[var(--ok-2)] text-[var(--ok-2)] bg-transparent">
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
              loading={exporter.isPending}
              data-evid-action="export-md"
            >
              {exporter.isPending ? 'Exporting…' : 'Export Markdown'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onExport('json')}
              loading={exporter.isPending}
              data-evid-action="export-json"
            >
              {exporter.isPending ? 'Exporting…' : 'Export JSON'}
            </Button>
          </div>
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
      navigate('/runs', { replace: true });
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
                  onClick={() => navigate(`/graph/${run.id}`)}
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
                  <TracePane run={run} />
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
