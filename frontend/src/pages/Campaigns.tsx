// Campaigns list — React translation of campaign-presenter.renderList()
// and the surrounding chrome in pages/campaigns-page.js.
//
// React Query owns the data; clicking a row navigates to
// /campaigns/:id (which mounts CampaignDetail in a Sheet). The
// page-header "+ New campaign" button navigates to /campaigns/new
// which mounts the CampaignCreate Dialog above the same list.
import { Link, Outlet, useNavigate } from 'react-router-dom';

import { CampaignPill } from '@/components/CampaignPill';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCampaigns } from '@/lib/useCampaigns';
import type { Campaign } from '@/lib/types';

function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const delta = (Date.now() - d.getTime()) / 1000;
  if (delta < 60) return `${Math.round(delta)}s`;
  if (delta < 3600) return `${Math.round(delta / 60)}m`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h`;
  return `${Math.round(delta / 86400)}d`;
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  const tps = (campaign.toolpack_ids || []).join(', ') || '—';
  const budget = campaign.run_budget || {};
  const objective = campaign.objective || '';
  const truncated = objective.length > 200;
  return (
    <li>
      <Link
        to={`/campaigns/${campaign.id}`}
        data-campaign-id={campaign.id}
        className="block rounded-md border border-border bg-card px-3.5 py-3 transition-colors hover:border-[var(--cy-2)] hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        aria-label={`Open ${campaign.title}`}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <CampaignPill status={campaign.status} />
          <span className="font-semibold text-foreground">{campaign.title}</span>
          {campaign.created_at ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {ago(campaign.created_at)} ago
            </span>
          ) : null}
        </div>
        <div className="text-[13px] text-[var(--fg-2)] mb-2 break-words">
          {objective.slice(0, 200)}
          {truncated ? '…' : ''}
        </div>
        <div className="flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
          <span>backend: {campaign.worker_backend || 'phantom-native'}</span>
          <span>toolpacks: {tps}</span>
          <span>runs cap: {budget.maxChildRuns ?? '—'}</span>
          <span>attempts/goal: {budget.maxAttemptsPerGoal ?? '—'}</span>
        </div>
      </Link>
    </li>
  );
}

function CampaignListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="campaigns-loading">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-[78px]" />
      ))}
    </div>
  );
}

function CampaignsEmpty() {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-card px-6 py-6 text-center text-muted-foreground"
      data-testid="campaigns-empty"
    >
      <p className="font-mono uppercase tracking-[0.08em] text-xs text-[var(--fg-2)] mb-1">
        No campaigns yet
      </p>
      <p className="text-[13px] text-[var(--fg-3)]">
        Campaigns are scoped, governed multi-run objectives. Click{' '}
        <strong className="text-foreground">+ New campaign</strong> to draft one.
      </p>
    </div>
  );
}

export function CampaignsPage() {
  const navigate = useNavigate();
  const { data: campaigns, isLoading, isError, error, refetch, isFetching } = useCampaigns();
  const list = campaigns ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        <PageHeader
          className="mb-4"
          eyebrow="Governed multi-run automation"
          title="Campaigns"
          description="Scoped security objectives that continue across child runs until completion, blocker, approval gate, budget limit, or stop. PHANTOM remains the supervisor — every child action is a normal PHANTOM run."
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="refresh-campaigns-btn"
              >
                ↻ Refresh
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/campaigns/new')}
                data-testid="new-campaign-btn"
              >
                <span aria-hidden="true">+</span> New campaign
              </Button>
            </>
          }
        />

        <section
          aria-label="Campaign list"
          data-empty={list.length === 0}
          className="py-4"
        >
          {isLoading ? (
            <CampaignListSkeleton />
          ) : isError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              Failed to load campaigns: {(error as Error)?.message ?? 'unknown error'}
            </div>
          ) : list.length === 0 ? (
            <CampaignsEmpty />
          ) : (
            <ul className="flex flex-col gap-2 list-none m-0 p-0">
              {list.map((c) => (
                <CampaignRow key={c.id} campaign={c} />
              ))}
            </ul>
          )}
        </section>

        {/* Mounts CampaignDetail (sheet) and CampaignCreate (dialog)
            via nested routes — they sit on top of the list. */}
        <Outlet />
      </div>
    </main>
  );
}

export default CampaignsPage;
