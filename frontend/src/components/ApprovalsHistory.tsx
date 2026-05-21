// ApprovalsHistory — page-scoped decision-history feed for the Approvals
// page.
//
// Ports the legacy frontend/js/pages/approvals-page.js renderEventList()/
// renderEventRow(): past approve/deny decisions with the decision label,
// the tool, the operator note, and the timestamp. Backed by the
// /api/approvals events list (ApprovalEvent[]) surfaced through the
// approvals bundle — there is no separate decision-history endpoint, so
// the feed renders the same events the audit list returns.
import { ListRow } from '@/components/ListRow';
import { Tooltip } from '@/components/ui/tooltip';
import type { ApprovalEvent } from '@/lib/types';

interface DecisionMeta {
  label: string;
  // Accent token for the decision label text.
  accent: string;
}

const DECISION_META: Record<string, DecisionMeta> = {
  granted: { label: '✓ APPROVED', accent: 'var(--ok-2)' },
  denied: { label: '✗ DENIED', accent: 'hsl(var(--destructive))' },
  'allow-once': { label: '⚡ ALLOW ONCE', accent: 'var(--cy-1)' },
  override: { label: '⚠ OVERRIDE', accent: 'var(--warn-2)' },
  timeout: { label: '⌛ TIMED OUT', accent: 'var(--fg-3)' },
};

function decisionMeta(decision: string): DecisionMeta {
  return DECISION_META[decision] ?? { label: decision.toUpperCase(), accent: 'var(--fg-2)' };
}

// Compact relative timestamp. Mirrors legacy timeAgo() — local to this
// page; a shared util does not yet exist (noted for a future extraction).
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = (Date.now() - t) / 60000;
  if (mins < 0) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function HistoryRow({ event }: { event: ApprovalEvent }) {
  const meta = decisionMeta(event.decision);
  const note = event.operatorNote || event.reason || null;
  const absolute = event.occurredAt
    ? new Date(event.occurredAt).toLocaleString()
    : 'unknown time';
  return (
    <li>
      <ListRow data-testid="approvals-history-row" className="cursor-default hover:border-border hover:bg-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em]"
            style={{ color: meta.accent }}
          >
            {meta.label}
          </span>
          <strong className="text-sm text-foreground">{event.toolName || 'tool'}</strong>
          {event.risk ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--fg-3)]">
              {event.risk}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {event.scopeName || event.scopeId || '—'}
          </span>
          <span className="ml-auto">
            <Tooltip content={absolute} side="left">
              <span className="font-mono text-[11px] text-[var(--fg-3)]">
                {timeAgo(event.occurredAt)}
              </span>
            </Tooltip>
          </span>
        </div>
        {note ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--fg-3)] mr-1.5">
              Note
            </span>
            {note}
          </p>
        ) : null}
      </ListRow>
    </li>
  );
}

interface ApprovalsHistoryProps {
  events: ApprovalEvent[];
}

export function ApprovalsHistory({ events }: ApprovalsHistoryProps) {
  return (
    <section aria-label="Decision history" data-testid="approvals-history" className="py-4">
      <header className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">Decision history</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          {events.length} recorded
        </span>
      </header>
      {events.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border bg-card px-4 py-4 text-center text-[13px] text-[var(--fg-3)]"
          data-testid="approvals-history-empty"
        >
          No decisions recorded yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2 list-none m-0 p-0" data-testid="approvals-history-list">
          {events.map((e) => (
            <HistoryRow key={e.id} event={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default ApprovalsHistory;
