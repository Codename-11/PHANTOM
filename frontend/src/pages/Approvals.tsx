// Approvals — pending install / scope / registry approval queue +
// persistent INLINE detail column (SplitPane, kit `.drawer` chrome).
// Renders the A3 EXPLAINED shape produced by
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
import { Link, Outlet, useMatch, useNavigate, useParams } from 'react-router-dom';

import { ApprovalCard } from '@/components/ApprovalCard';
import { ApprovalsHistory } from '@/components/ApprovalsHistory';
import { ApprovalsKpiStrip } from '@/components/ApprovalsKpiStrip';
import { EngagingIcon } from '@/components/AgentStateIcon';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IcX } from '@/components/ui/icons';
import { SplitPane } from '@/components/ui/split-pane';
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
  const detailOpen = !!useMatch('/approvals/:id');
  const { data, isLoading, isError, error, refetch, isFetching } = useApprovals();
  const list = data?.pending ?? [];
  const stats = data?.stats ?? { total: 0, byDecision: {}, byRisk: {}, series: [] };
  const historyEvents = data?.history?.events ?? [];

  // The master column: KPI strip + the pending queue + decision history.
  // Lives inside the SplitPane's list slot so it stays visible beside the
  // inline detail column on desktop.
  const listColumn = (
    <div className="p-6">
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
    </div>
  );

  return (
    <main className="flex h-[calc(100vh-3rem)] flex-col bg-background text-foreground font-sans">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Operator decision queue"
          title="Approvals"
          description="Every high-risk action — installs, scope overrides, future registry imports — pauses here until you approve or deny. High and critical denials require an operator note for the audit trail."
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="refresh-approvals-btn"
            >
              ↻ Refresh
            </Button>
          }
        />
      </div>

      <div className="min-h-0 flex-1">
        <SplitPane
          list={listColumn}
          detail={<Outlet />}
          detailOpen={detailOpen}
          detailWidth={420}
        />
      </div>
    </main>
  );
}

// ── Inline detail column (mounted at /approvals/:id) ──────────────────

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
  const [denyOpen, setDenyOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const { toast } = useToast();

  const { data: approval, isLoading, isError, error } = useApprovalDetail(id);
  const { approve, deny } = useApprovalAction(id);

  function close() {
    navigate('/approvals', { replace: true });
  }

  async function handleApprove() {
    setFeedback(null);
    try {
      await approve.mutateAsync();
      setFeedback({ kind: 'ok', text: '✓ Install approved.' });
      toast({ title: 'Install approved', description: 'Install commands are running.', variant: 'success' });
      setTimeout(close, 600);
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
      setTimeout(close, 600);
    } catch (err) {
      const text = (err as Error).message;
      setFeedback({ kind: 'err', text: `✗ ${text}` });
      toast({ title: 'Deny failed', description: text, variant: 'error' });
    }
  }

  return (
    <div className="drawer" data-testid="approval-detail-sheet" style={{ height: '100%' }}>
      {isLoading ? (
        <DetailSkeleton />
      ) : isError || !approval ? (
        <div className="drawer-hd">
          <div className="grow">
            <div className="title">Failed to load</div>
            <div className="sub">{(error as Error)?.message ?? 'Approval not found.'}</div>
            <div className="mt-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/approvals">Back to list</Link>
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={close}
            aria-label="Close detail"
            data-testid="approval-detail-close"
          >
            <IcX />
          </Button>
        </div>
      ) : (
        <>
          <div className="drawer-hd">
            <div className="grow">
              <div className="title">Approval</div>
              <div className="sub">
                Review the structured fields below before approving or denying.
                Raw upstream JSON is available under <em>Raw details</em>.
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={close}
              aria-label="Close detail"
              data-testid="approval-detail-close"
            >
              <IcX />
            </Button>
          </div>

          <div className="drawer-bd px-4 py-4">
            <ApprovalCard approval={approval} mode="detail" />
          </div>

          <div className="drawer-ft" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
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
            {approve.isPending ? (
              <div
                role="status"
                className="flex items-center gap-2 text-xs text-[var(--cy-1)]"
                data-testid="approval-engaging"
              >
                <EngagingIcon size={20} />
                <span className="font-mono uppercase tracking-[0.06em]">
                  Engaging · running authorized install…
                </span>
              </div>
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
    </div>
  );
}

export default ApprovalsPage;
