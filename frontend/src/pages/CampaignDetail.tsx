// Campaign detail Sheet — translates the four drawer panes from
// campaign-presenter.js (Overview / Goals / Runs / Evidence) into a
// Radix-Sheet + shadcn-Tabs surface.
//
// Mounts as a nested route under /campaigns/:id; closing the
// Sheet navigates back to /campaigns so the list stays visible.
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

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
import { CampaignPill, mapGoalStatus, mapRunStatus } from '@/components/CampaignPill';
import { Badge } from '@/components/ui/badge';
import { useCampaign, useLifecycleAction } from '@/lib/useCampaigns';
import type { Campaign, CampaignReplay } from '@/lib/types';

function OverviewPane({ replay }: { replay: CampaignReplay }) {
  const c = replay.campaign;
  const rb = c.run_budget || {};
  const risk = c.risk_budget || {};
  const s = replay.summary;
  const allowed = risk.allowedRiskClasses || [];
  const blocked = risk.blockedRiskClasses || [];
  return (
    <div className="space-y-4 py-3">
      <dl className="grid grid-cols-[110px_1fr] gap-x-3.5 gap-y-1.5 text-[12px]">
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Backend
        </dt>
        <dd className="text-foreground">{c.worker_backend}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Scope
        </dt>
        <dd className="text-foreground">
          {c.scope_id ? (
            <span className="font-mono">{c.scope_id}</span>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">—</span>
          )}
        </dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Toolpacks
        </dt>
        <dd>
          {(c.toolpack_ids || []).length === 0 ? (
            <span className="font-mono text-[11px] text-muted-foreground">—</span>
          ) : (
            (c.toolpack_ids || []).map((t) => (
              <Badge key={t} variant="outline" className="mr-1 mb-1">
                {t}
              </Badge>
            ))
          )}
        </dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Started
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{c.started_at || '—'}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Ended
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{c.ended_at || '—'}</dd>
      </dl>

      <div className="grid grid-cols-4 gap-2">
        {[
          { num: s.totalRuns, cap: 'runs' },
          { num: s.totalFindings, cap: 'findings' },
          { num: s.totalArtifacts, cap: 'artifacts' },
          { num: s.totalBlocked, cap: 'blocked' },
        ].map((kpi) => (
          <div
            key={kpi.cap}
            className="flex flex-col items-center justify-center rounded-md border border-border bg-[var(--bg-3)] px-2 py-2.5 transition-colors hover:border-[var(--cy-2)]"
          >
            <span className="font-mono text-[22px] leading-none text-[var(--cy-1)]">
              {kpi.num}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              {kpi.cap}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-1.5 text-[12px] text-muted-foreground">
        <div>
          <strong className="text-foreground">Budget:</strong>{' '}
          {s.budgetUsed.runs} / {s.budgetUsed.maxRuns} runs ·{' '}
          {rb.maxAttemptsPerGoal ?? '—'} attempts / goal ·{' '}
          {rb.maxWallClockMinutes ?? '—'}m cap
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <strong className="text-foreground mr-1">Risk classes:</strong>
          {allowed.map((r) => (
            <Badge
              key={`a-${r}`}
              className="border-[var(--ok-2)] text-[var(--ok-2)] bg-transparent"
            >
              {r}
            </Badge>
          ))}
          {blocked.map((r) => (
            <Badge
              key={`b-${r}`}
              variant="outline"
              className="text-muted-foreground line-through opacity-75"
            >
              {r}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function GoalsPane({ replay }: { replay: CampaignReplay }) {
  if (!replay.goals.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-4 text-sm text-muted-foreground">
        No goals queued yet. Add one using the campaign's{' '}
        <strong className="text-foreground">Add goal</strong> form (creation form lands as
        part of the same campaign drawer).
      </div>
    );
  }
  return (
    <ol className="space-y-3 list-none m-0 p-0">
      {replay.goals.map((g) => {
        const verdict = g.evaluator_result;
        return (
          <li
            key={g.id}
            className="relative rounded-md border border-border bg-card px-3 py-2.5"
            data-status={g.status}
          >
            <div className="flex items-center gap-2 mb-1">
              <CampaignPill status={mapGoalStatus(g.status)} />
              <span className="text-sm font-semibold text-foreground">{g.title}</span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {g.attempt_count} / {g.max_attempts}
              </span>
            </div>
            <p className="text-[13px] text-[var(--fg-2)] break-words">
              {(g.prompt || '').slice(0, 220)}
              {(g.prompt || '').length > 220 ? '…' : ''}
            </p>
            {verdict ? (
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {verdict.decision}
                </Badge>
                <span className="text-[12px] text-muted-foreground">{verdict.summary}</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function RunsPane({ replay }: { replay: CampaignReplay }) {
  if (!replay.runs.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-4 text-sm text-muted-foreground">
        No child runs yet. Start the campaign and click{' '}
        <strong className="text-foreground">Run next goal</strong> to spawn the first child
        run.
      </div>
    );
  }
  return (
    <ul className="space-y-2 list-none m-0 p-0">
      {replay.runs.map((r) => (
        <li
          key={r.run.id}
          className="rounded-md border border-border bg-card px-3 py-2.5"
          data-run-id={r.run.id}
          tabIndex={0}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-foreground">
              {r.run.title || r.run.id.slice(0, 8)}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {r.run.id.slice(0, 8)}
            </span>
            <CampaignPill status={mapRunStatus(r.run.status)} className="ml-auto" />
          </div>
          <div className="flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
            <span>goal: {r.goal?.title || '—'}</span>
            <span>findings: {r.findingCount}</span>
            <span>artifacts: {r.artifactCount}</span>
            <span>blocked: {r.blockedCount}</span>
          </div>
          {r.evaluator ? (
            <div className="mt-1.5 text-[12px] text-muted-foreground">
              verdict <strong className="text-foreground">{r.evaluator.decision}</strong> —{' '}
              {r.evaluator.summary || ''}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface EvidencePaneProps {
  onReport: () => Promise<void>;
  onEvidence: () => Promise<void>;
  feedback: { kind: 'success' | 'error'; text: string } | null;
  pending: 'report' | 'evidence' | null;
}

function EvidencePane({ onReport, onEvidence, feedback, pending }: EvidencePaneProps) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Generate a campaign-level markdown report or a zip evidence bundle that aggregates
          every child run.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onReport()}
            disabled={pending !== null}
            data-campaign-action="report"
          >
            {pending === 'report' ? 'Generating…' : 'Generate report'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onEvidence()}
            disabled={pending !== null}
            data-campaign-action="evidence"
          >
            {pending === 'evidence' ? 'Bundling…' : 'Export evidence bundle'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Artifacts attach to the first linked child run so they appear in{' '}
          <strong className="text-foreground">Artifacts</strong>. They are tagged with{' '}
          <code className="font-mono">source=campaign_report</code> /{' '}
          <code className="font-mono">campaign_evidence_bundle</code> for filtering.
        </p>
        {feedback ? (
          <div
            role="status"
            className={
              feedback.kind === 'success'
                ? 'text-xs text-[var(--ok-2)]'
                : 'text-xs text-destructive'
            }
          >
            {feedback.text}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LifecycleButtons({
  campaign,
  onAction,
  pending,
}: {
  campaign: Campaign;
  onAction: (action: 'start' | 'pause' | 'resume' | 'cancel' | 'run-next') => void;
  pending: boolean;
}) {
  const status = campaign.status;
  const buttons: Array<{ key: string; label: string; variant: 'primary' | 'ghost' | 'destructive'; action: 'start' | 'pause' | 'resume' | 'cancel' | 'run-next' }> = [];
  if (['draft', 'paused', 'queued'].includes(status)) {
    buttons.push({ key: 'start', label: 'Set goal in motion', variant: 'primary', action: 'start' });
  }
  if (['running', 'needs_approval'].includes(status)) {
    buttons.push({ key: 'pause', label: 'Pause workers', variant: 'ghost', action: 'pause' });
  }
  if (['paused', 'needs_approval'].includes(status)) {
    buttons.push({ key: 'resume', label: 'Resume', variant: 'primary', action: 'resume' });
  }
  if (status === 'running') {
    buttons.push({ key: 'run-next', label: 'Run next goal', variant: 'ghost', action: 'run-next' });
  }
  if (!['canceled', 'completed', 'failed'].includes(status)) {
    buttons.push({ key: 'cancel', label: 'Cancel', variant: 'destructive', action: 'cancel' });
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {buttons.map((b) => (
        <Button
          key={b.key}
          variant={b.variant}
          size="sm"
          disabled={pending}
          onClick={() => onAction(b.action)}
          data-campaign-action={b.action}
        >
          {b.label}
        </Button>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="px-4 py-6 space-y-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function CampaignDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [evidenceFeedback, setEvidenceFeedback] = useState<
    { kind: 'success' | 'error'; text: string } | null
  >(null);
  const [pendingArtifact, setPendingArtifact] = useState<'report' | 'evidence' | null>(null);

  const { data: replay, isLoading, isError, error } = useCampaign(id);
  const lifecycle = useLifecycleAction(id);

  // The Sheet's open state and the route are kept in sync — closing the
  // sheet pops back to the list URL so the legacy route stays clean.
  useEffect(() => {
    if (!open) {
      navigate('/campaigns', { replace: true });
    }
  }, [open, navigate]);

  const onLifecycle = async (
    action: 'start' | 'pause' | 'resume' | 'cancel' | 'run-next',
  ) => {
    if (action === 'cancel') {
      // eslint-disable-next-line no-alert
      if (!window.confirm('Cancel this campaign? Queued goals become skipped.')) {
        return;
      }
    }
    try {
      await lifecycle.mutateAsync(action);
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(`Campaign action failed: ${(err as Error).message}`);
    }
  };

  const onArtifact = async (action: 'report' | 'evidence') => {
    setPendingArtifact(action);
    setEvidenceFeedback(null);
    try {
      const result = (await lifecycle.mutateAsync(action)) as
        | { id?: string; title?: string }
        | unknown;
      const r = result as { id?: string; title?: string };
      if (action === 'report') {
        setEvidenceFeedback({
          kind: 'success',
          text: `✓ report artifact ${r?.id ?? ''}`,
        });
      } else {
        setEvidenceFeedback({
          kind: 'success',
          text: `✓ evidence bundle ${r?.id ?? ''}${r?.title ? ` · ${r.title}` : ''}`,
        });
      }
    } catch (err) {
      setEvidenceFeedback({ kind: 'error', text: `✗ ${(err as Error).message}` });
    } finally {
      setPendingArtifact(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" data-testid="campaign-detail-sheet">
        {isLoading ? (
          <DetailSkeleton />
        ) : isError || !replay ? (
          <SheetHeader>
            <SheetTitle>Failed to load</SheetTitle>
            <SheetDescription>
              {(error as Error)?.message ?? 'Campaign not found.'}
            </SheetDescription>
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <CampaignPill status={replay.campaign.status} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {replay.campaign.id}
                </span>
              </div>
              <SheetTitle>{replay.campaign.title}</SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                {replay.campaign.objective}
              </SheetDescription>
              <LifecycleButtons
                campaign={replay.campaign}
                onAction={(a) => void onLifecycle(a)}
                pending={lifecycle.isPending}
              />
            </SheetHeader>

            <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
              <TabsList aria-label="Campaign detail tabs">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="goals">
                  Goals
                  {replay.goals.length > 0 ? (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      · {replay.goals.length}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="runs">
                  Runs
                  {replay.runs.length > 0 ? (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      · {replay.runs.length}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="evidence">Evidence</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                <TabsContent value="overview">
                  <OverviewPane replay={replay} />
                </TabsContent>
                <TabsContent value="goals">
                  <GoalsPane replay={replay} />
                </TabsContent>
                <TabsContent value="runs">
                  <RunsPane replay={replay} />
                </TabsContent>
                <TabsContent value="evidence">
                  <EvidencePane
                    onReport={() => onArtifact('report')}
                    onEvidence={() => onArtifact('evidence')}
                    feedback={evidenceFeedback}
                    pending={pendingArtifact}
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

export default CampaignDetailRoute;
