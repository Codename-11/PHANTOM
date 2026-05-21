// Scope — React translation of the legacy scope-page.js list + detail
// surface. Mirrors the Campaigns layout: a list of authorized scopes on
// the left, with the detail drawer (Sheet) sliding in from the right
// when the operator clicks a row.
//
// Asset management and the full builder (intent tiles, ROE templates,
// action-class matrix) STAY on the legacy /scope page for now — the
// React preview ships just the create-scope shortcut (Dialog form) and
// the list/detail read path so operators can sanity-check the new shell.
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';

import { ScopePill } from '@/components/ScopePill';
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
import { countScopeTargets, deriveScopeStatus, useScope, useScopes } from '@/lib/scopes';
import type { ScopeRecord } from '@/lib/types';

function ScopeListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="scopes-loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[72px]" />
      ))}
    </div>
  );
}

function ScopesEmpty() {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-card px-6 py-6 text-center text-muted-foreground"
      data-testid="scopes-empty"
    >
      <p className="font-mono uppercase tracking-[0.08em] text-xs text-[var(--fg-2)] mb-1">
        No scopes yet
      </p>
      <p className="text-[13px] text-[var(--fg-3)]">
        Scopes bound where PHANTOM may operate. Click{' '}
        <strong className="text-foreground">+ New scope</strong> to authorize one.
      </p>
    </div>
  );
}

function ScopeRow({ scope }: { scope: ScopeRecord }) {
  const status = deriveScopeStatus(scope);
  const targetCount = countScopeTargets(scope);
  const allowed = scope.allowed_actions || [];
  return (
    <li>
      <Link
        to={`/scope/${scope.id}`}
        data-scope-id={scope.id}
        className="block rounded-md border border-border bg-card px-3.5 py-3 transition-colors hover:border-[var(--cy-2)] hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        aria-label={`Open ${scope.name}`}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <ScopePill status={status} />
          <span className="font-semibold text-foreground">{scope.name}</span>
          {scope.expires_at ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              expires {scope.expires_at}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
          <span>targets: {targetCount}</span>
          <span>allowed: {allowed.length ? allowed.join(', ') : 'default policy'}</span>
        </div>
      </Link>
    </li>
  );
}

export function ScopesPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch, isFetching } = useScopes();
  const list = data ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        <header className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
              Authorized operating boundaries
            </p>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Scope</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Each scope authorizes PHANTOM to act against a specific set of targets
              with a specific action-class policy. The legacy{' '}
              <code className="font-mono">/scope</code> page still hosts the full builder.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="refresh-scopes-btn"
            >
              ↻ Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/scope/new')}
              data-testid="new-scope-btn"
            >
              <span aria-hidden="true">+</span> New scope
            </Button>
          </div>
        </header>

        <section aria-label="Scope list" data-empty={list.length === 0} className="py-4">
          {isLoading ? (
            <ScopeListSkeleton />
          ) : isError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              Failed to load scopes: {(error as Error)?.message ?? 'unknown error'}
            </div>
          ) : list.length === 0 ? (
            <ScopesEmpty />
          ) : (
            <ul className="flex flex-col gap-2 list-none m-0 p-0" data-testid="scopes-list">
              {list.map((s) => (
                <ScopeRow key={s.id} scope={s} />
              ))}
            </ul>
          )}
        </section>

        <Outlet />
      </div>
    </main>
  );
}

// ── Detail Sheet (mounted at /scope/:id) ──────────────────────────────

function TargetList({ label, items }: { label: string; items: string[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground mb-1">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={`${label}-${item}`} variant="outline" className="font-mono">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function ScopeDetailBody({ scope }: { scope: ScopeRecord }) {
  const targets = scope.targets || {};
  return (
    <div className="px-4 py-3 space-y-4">
      <dl className="grid grid-cols-[110px_1fr] gap-x-3.5 gap-y-1.5 text-[12px]">
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          ID
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{scope.id}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Created
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{scope.created_at}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
          Expires
        </dt>
        <dd className="font-mono text-[11px] text-[var(--fg-2)]">{scope.expires_at || '—'}</dd>
      </dl>

      <div className="space-y-3">
        <TargetList label="Hosts" items={targets.hosts} />
        <TargetList label="Domains" items={targets.domains} />
        <TargetList label="CIDRs" items={targets.cidrs} />
        <TargetList label="URLs" items={targets.urls} />
      </div>

      <div className="space-y-2">
        <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
          Allowed actions
        </p>
        <div className="flex flex-wrap gap-1">
          {(scope.allowed_actions || []).length === 0 ? (
            <span className="font-mono text-[11px] text-muted-foreground">— default policy —</span>
          ) : (
            (scope.allowed_actions || []).map((a) => (
              <Badge key={`a-${a}`} className="border-[var(--ok-2)] text-[var(--ok-2)] bg-transparent">
                {a}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
          Blocked actions
        </p>
        <div className="flex flex-wrap gap-1">
          {(scope.blocked_actions || []).length === 0 ? (
            <span className="font-mono text-[11px] text-muted-foreground">— none —</span>
          ) : (
            (scope.blocked_actions || []).map((a) => (
              <Badge key={`b-${a}`} variant="outline" className="text-muted-foreground line-through">
                {a}
              </Badge>
            ))
          )}
        </div>
      </div>

      {scope.notes ? (
        <div className="space-y-1">
          <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
            Notes
          </p>
          <p className="text-sm text-[var(--fg-2)] whitespace-pre-wrap">{scope.notes}</p>
        </div>
      ) : null}

      {scope.rules_of_engagement ? (
        <div className="space-y-1">
          <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
            Rules of engagement
          </p>
          <p className="text-sm text-[var(--fg-2)] whitespace-pre-wrap">
            {scope.rules_of_engagement}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ScopeDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const { data, isLoading, isError, error } = useScope(id);

  useEffect(() => {
    if (!open) navigate('/scope', { replace: true });
  }, [open, navigate]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" data-testid="scope-detail-sheet">
        {isLoading ? (
          <div className="px-4 py-6 space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError || !data ? (
          <SheetHeader>
            <SheetTitle>Failed to load</SheetTitle>
            <SheetDescription>
              {(error as Error)?.message ?? 'Scope not found.'}
            </SheetDescription>
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <ScopePill status={deriveScopeStatus(data)} />
                <span className="font-mono text-[10px] text-muted-foreground">{data.id}</span>
              </div>
              <SheetTitle>{data.name}</SheetTitle>
              <SheetDescription>
                {countScopeTargets(data)} target{countScopeTargets(data) === 1 ? '' : 's'} ·{' '}
                {(data.allowed_actions || []).length} allowed action
                {(data.allowed_actions || []).length === 1 ? '' : 's'}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              <ScopeDetailBody scope={data} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default ScopesPage;
