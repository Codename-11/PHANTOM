// Onboarding — standalone page version of the Dash checklist. Five
// Card rows with status icons + CTAs, plus the Load demo / Clear demo
// affordances. Unlike the Dash widget this page never auto-hides — the
// operator can return at any time to re-run the checklist or reset
// demo data.
//
// Routes:
//   /react/onboarding — the page itself.
//
// Backed by /api/onboarding/checklist (read), /api/onboarding/load-demo
// (mutation), /api/onboarding/clear-demo (mutation).

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ONBOARDING_ITEMS,
  useChecklist,
  useClearDemo,
  useLoadDemo,
} from '@/lib/onboarding';
import type { OnboardingChecklist, OnboardingItem } from '@/lib/types';

function StatusIcon({ checked }: { checked: boolean }) {
  if (checked) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#66c293] bg-[#66c293]/15 text-[#66c293]"
        aria-label="Done"
        data-testid="onb-item-done"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line-3)] bg-[var(--bg-3)] text-muted-foreground"
      aria-label="Pending"
      data-testid="onb-item-pending"
    >
      ○
    </span>
  );
}

function reactRoute(route: string | undefined): string {
  if (!route) return '/react/dash';
  return `/react/${route}`;
}

interface RowProps {
  item: OnboardingItem;
  checked: boolean;
  onLoadDemo: () => void;
  busy: boolean;
}

function ChecklistRow({ item, checked, onLoadDemo, busy }: RowProps) {
  return (
    <Card data-testid={`onb-row-${item.id}`} data-onb-checked={checked}>
      <CardContent className="flex items-start gap-3 p-3.5">
        <StatusIcon checked={checked} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          <p className="text-[12px] text-muted-foreground">{item.help}</p>
        </div>
        <div className="shrink-0">
          {checked ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#66c293]">
              Done
            </span>
          ) : item.ctaAction === 'load-demo' ? (
            <Button variant="primary" size="sm" onClick={onLoadDemo} disabled={busy}>
              {busy ? 'Loading…' : item.ctaLabel}
            </Button>
          ) : (
            <Button variant="primary" size="sm" asChild>
              <Link to={reactRoute(item.ctaRoute)}>{item.ctaLabel}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ChecklistSectionProps {
  data: OnboardingChecklist;
  onLoadDemo: () => void;
  loading: boolean;
}

function ChecklistSection({ data, onLoadDemo, loading }: ChecklistSectionProps) {
  const items = data.checklist;
  return (
    <ul className="space-y-2 list-none m-0 p-0" data-testid="onb-checklist">
      {ONBOARDING_ITEMS.map((it) => (
        <li key={it.id}>
          <ChecklistRow
            item={it}
            checked={!!items[it.id]}
            onLoadDemo={onLoadDemo}
            busy={loading && it.ctaAction === 'load-demo'}
          />
        </li>
      ))}
    </ul>
  );
}

function OnboardingSkeleton() {
  return (
    <div className="space-y-2" data-testid="onb-loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-[72px]" />
      ))}
    </div>
  );
}

export function OnboardingPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useChecklist();
  const loadDemo = useLoadDemo();
  const clearDemo = useClearDemo();

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function handleLoadDemo(reset = false) {
    setFeedback(null);
    try {
      await loadDemo.mutateAsync(reset);
      setFeedback({ kind: 'ok', text: '✓ Demo data loaded.' });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 409 && !reset) {
        setResetConfirmOpen(true);
        return;
      }
      setFeedback({ kind: 'err', text: `✗ Load demo failed: ${e.message || 'unknown error'}` });
    }
  }

  async function handleClearDemo() {
    setFeedback(null);
    setClearConfirmOpen(false);
    try {
      await clearDemo.mutateAsync();
      setFeedback({ kind: 'ok', text: '✓ Demo data cleared.' });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: `✗ Clear demo failed: ${(err as Error)?.message || 'unknown error'}`,
      });
    }
  }

  const unchecked = data
    ? ONBOARDING_ITEMS.filter((i) => !data.checklist[i.id]).length
    : ONBOARDING_ITEMS.length;

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
              Get started
            </p>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Onboarding</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Five steps to a fully-wired PHANTOM workspace. Load the demo scenario
              first to see the surface populated, or skip ahead and authorize a
              real scope.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="refresh-onb-btn"
            >
              ↻ Refresh
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/react/dash">Back to Dash</Link>
            </Button>
          </div>
        </header>

        {isLoading ? (
          <OnboardingSkeleton />
        ) : isError || !data ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            Failed to load onboarding: {(error as Error)?.message ?? 'unknown error'}
          </div>
        ) : (
          <>
            <Card data-testid="onb-summary">
              <CardHeader>
                <CardTitle>
                  {data.complete
                    ? 'PHANTOM is set up'
                    : `${unchecked} step${unchecked === 1 ? '' : 's'} left`}
                </CardTitle>
                <CardDescription>
                  {data.complete
                    ? 'All five readiness checks pass. You can still re-run the demo seed below.'
                    : "Tick each row off in order — they unlock the next surface as you go."}
                </CardDescription>
              </CardHeader>
            </Card>

            <ChecklistSection
              data={data}
              onLoadDemo={() => void handleLoadDemo(false)}
              loading={loadDemo.isPending}
            />

            <Card>
              <CardHeader>
                <CardTitle>Demo data</CardTitle>
                <CardDescription>
                  Load synthetic scopes, assets, runs, and findings to see PHANTOM
                  populated — every row is watermarked <code className="font-mono">[demo]</code>{' '}
                  so you can clear it cleanly later.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleLoadDemo(false)}
                  disabled={loadDemo.isPending}
                  data-testid="load-demo-btn"
                >
                  {loadDemo.isPending ? 'Loading…' : 'Load demo'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={clearDemo.isPending}
                  data-testid="clear-demo-btn"
                >
                  {clearDemo.isPending ? 'Clearing…' : 'Clear demo'}
                </Button>
                {feedback ? (
                  <p
                    role="status"
                    className={
                      feedback.kind === 'ok'
                        ? 'ml-auto text-xs text-[#66c293]'
                        : 'ml-auto text-xs text-destructive'
                    }
                  >
                    {feedback.text}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Demo data already present</DialogTitle>
            <DialogDescription>
              The seed reports demo rows already exist. Reset and reseed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setResetConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setResetConfirmOpen(false);
                void handleLoadDemo(true);
              }}
            >
              Reset and reseed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear demo data?</DialogTitle>
            <DialogDescription>
              This deletes every <code className="font-mono">[demo]</code>-tagged scope,
              asset, run, and finding. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setClearConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleClearDemo()}>
              Clear demo data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default OnboardingPage;
