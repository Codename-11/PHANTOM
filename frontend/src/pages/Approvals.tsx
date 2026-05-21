// Approvals — pending install / scope / registry approval queue +
// detail drawer (Sheet). Renders the A3 EXPLAINED shape produced by
// server/approvals/explain.js, with raw JSON tucked inside a
// <details> disclosure.
//
// A8.5b parity-close: ports the two features the React surface used to
// defer to the legacy bundle —
//   - KPI strip (ApprovalsKpiStrip) — decision counts from
//     /api/approvals/stats.
//   - Decision-history feed (ApprovalsHistory) — past approve/deny
//     decisions from the /api/approvals events list. There is no
//     dedicated history endpoint; the feed renders the audit events.
//
// Mutations:
//   - Approve install   → POST /api/installer/requests/:id/approve
//   - Deny install      → POST /api/installer/requests/:id/cancel
//                         (denial_reason required for high|crit risk)
//
// Served at bare /approvals + /approvals/:id (A8.5 cutover).

import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';

import { ApprovalCard } from '@/components/ApprovalCard';
import { ApprovalsHistory } from '@/components/ApprovalsHistory';
import { ApprovalsKpiStrip } from '@/components/ApprovalsKpiStrip';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  requiresDenialReason,
  useApprovalAction,
  useApprovalDetail,
  useApprovals,
} from '@/lib/approvals';
import type { ApprovalRecord } from '@/lib/types';

function ApprovalsListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="approvals-loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[120px]" />
      ))}
    </div>
  );
}

function ApprovalsEmpty() {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-card px-6 py-6 text-center text-muted-foreground"
      data-testid="approvals-empty"
    >
      <p className="font-mono uppercase tracking-[0.08em] text-xs text-[var(--fg-2)] mb-1">
        No pending approvals
      </p>
      <p className="text-[13px] text-[var(--fg-3)]">
        High-risk actions land here for operator review. Past decisions are listed
        in the decision-history feed below.
      </p>
    </div>
  );
}

export function ApprovalsPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch, isFetching } = useApprovals();
  const list = data?.pending ?? [];
  const stats = data?.stats ?? { total: 0, byDecision: {}, byRisk: {}, series: [] };
  const historyEvents = data?.history?.events ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        <header className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
              Operator decision queue
            </p>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Approvals</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Every high-risk action — installs, scope overrides, future registry
              imports — pauses here until you approve or deny. High and critical
              denials require an operator note for the audit trail.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="refresh-approvals-btn"
            >
              ↻ Refresh
            </Button>
          </div>
        </header>

        {!isLoading && !isError ? (
          <ApprovalsKpiStrip stats={stats} pendingCount={list.length} />
        ) : null}

        <section aria-label="Approval queue" className="py-4">
          {isLoading ? (
            <ApprovalsListSkeleton />
          ) : isError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              Failed to load approvals: {(error as Error)?.message ?? 'unknown error'}
            </div>
          ) : list.length === 0 ? (
            <ApprovalsEmpty />
          ) : (
            <ul
              className="flex flex-col gap-2 list-none m-0 p-0"
              data-testid="approvals-list"
            >
              {list.map((a) => (
                <li key={a.id}>
                  <ApprovalCard
                    approval={a}
                    onClick={() => navigate(`/approvals/${a.id}`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {!isLoading && !isError ? <ApprovalsHistory events={historyEvents} /> : null}

        <Outlet />
      </div>
    </main>
  );
}

// ── Detail Sheet (mounted at /approvals/:id) ──────────────────────────

function DetailSkeleton() {
  return (
    <div className="px-4 py-6 space-y-3" data-testid="approval-detail-loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

interface DenyDialogProps {
  open: boolean;
  approval: ApprovalRecord | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  submitting: boolean;
}

function DenyDialog({ open, approval, onCancel, onConfirm, submitting }: DenyDialogProps) {
  const [note, setNote] = useState('');
  // Reset the textarea whenever the dialog closes or the approval changes.
  useEffect(() => {
    if (!open) setNote('');
  }, [open]);
  const needsNote = approval ? requiresDenialReason(approval.riskClass) : false;
  const canSubmit = !needsNote || note.trim().length > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent data-testid="deny-dialog">
        <DialogHeader>
          <DialogTitle>Deny approval</DialogTitle>
          <DialogDescription>
            {needsNote
              ? `${(approval?.riskClass || 'high-risk').toUpperCase()} denials require an operator note for the audit trail.`
              : 'You can optionally record why this is being denied.'}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-4">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={needsNote ? 'Why is this being denied? (required)' : 'Optional note'}
            rows={4}
            data-testid="deny-note-input"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={submitting}
            disabled={!canSubmit}
            onClick={() => void onConfirm(note.trim())}
            data-testid="deny-confirm-btn"
          >
            {submitting ? 'Denying…' : 'Confirm deny'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApprovalDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [denyOpen, setDenyOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const { toast } = useToast();

  const { data: approval, isLoading, isError, error } = useApprovalDetail(id);
  const { approve, deny } = useApprovalAction(id);

  useEffect(() => {
    if (!open) navigate('/approvals', { replace: true });
  }, [open, navigate]);

  async function handleApprove() {
    setFeedback(null);
    try {
      await approve.mutateAsync();
      setFeedback({ kind: 'ok', text: '✓ Install approved.' });
      toast({ title: 'Install approved', description: 'Install commands are running.', variant: 'success' });
      setTimeout(() => setOpen(false), 600);
    } catch (err) {
      const text = (err as Error).message;
      setFeedback({ kind: 'err', text: `✗ ${text}` });
      toast({ title: 'Approve failed', description: text, variant: 'error' });
    }
  }

  async function handleDeny(reason: string) {
    setFeedback(null);
    try {
      await deny.mutateAsync(reason);
      setFeedback({ kind: 'ok', text: '✓ Denied.' });
      toast({ title: 'Approval denied', variant: 'success' });
      setDenyOpen(false);
      setTimeout(() => setOpen(false), 600);
    } catch (err) {
      const text = (err as Error).message;
      setFeedback({ kind: 'err', text: `✗ ${text}` });
      toast({ title: 'Deny failed', description: text, variant: 'error' });
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" data-testid="approval-detail-sheet">
        {isLoading ? (
          <DetailSkeleton />
        ) : isError || !approval ? (
          <SheetHeader>
            <SheetTitle>Failed to load</SheetTitle>
            <SheetDescription>
              {(error as Error)?.message ?? 'Approval not found.'}
            </SheetDescription>
            <div className="mt-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/approvals">Back to list</Link>
              </Button>
            </div>
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Approval</SheetTitle>
              <SheetDescription>
                Review the structured fields below before approving or denying.
                Raw upstream JSON is available under <em>Raw details</em>.
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <ApprovalCard approval={approval} mode="detail" />
            </div>

            <div className="border-t border-border px-4 py-3 space-y-2">
              {feedback ? (
                <p
                  role="status"
                  className={
                    feedback.kind === 'ok'
                      ? 'text-xs text-[var(--ok-2)]'
                      : 'text-xs text-destructive'
                  }
                >
                  {feedback.text}
                </p>
              ) : null}
              {approval.status === 'pending' ? (
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDenyOpen(true)}
                    disabled={approve.isPending || deny.isPending}
                    data-testid="approval-deny-btn"
                  >
                    Deny
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleApprove()}
                    loading={approve.isPending}
                    disabled={deny.isPending}
                    data-testid="approval-approve-btn"
                  >
                    {approve.isPending ? 'Approving…' : 'Approve & install'}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-right">
                  Resolved · {approval.status.toUpperCase()}
                </p>
              )}
            </div>

            <DenyDialog
              open={denyOpen}
              approval={approval}
              onCancel={() => setDenyOpen(false)}
              onConfirm={handleDeny}
              submitting={deny.isPending}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default ApprovalsPage;
