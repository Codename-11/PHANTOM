// ApprovalCard — pure renderer for one ApprovalRecord (the EXPLAINED
// shape produced by server/approvals/explain.js). Used in two places:
//   1. The Approvals list (compact / clickable, mode="list").
//   2. The detail Sheet header (mode="detail" — full structured fields).
//
// Mirrors the legacy frontend/js/pages/approvals-page.js renderApprovalCard()
// visual contract: status badge, risk class chip, target line, structured
// rows (ACTION / REASON / EFFECT / SIDE FX / DENIED) and a collapsed
// <details> for raw JSON.
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import type { ApprovalRecord } from '@/lib/types';

interface ApprovalCardProps {
  approval: ApprovalRecord;
  mode?: 'list' | 'detail';
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

const RISK_TINT: Record<string, string> = {
  exploit:         'border-destructive bg-destructive/10 text-destructive',
  destructive:     'border-destructive bg-destructive/10 text-destructive',
  credentialed:    'border-[var(--warn-2)] bg-[var(--warn-2)]/10 text-[var(--warn-2)]',
  'online-bruteforce':       'border-[var(--warn-2)] bg-[var(--warn-2)]/10 text-[var(--warn-2)]',
  'offline-password-audit':  'border-[var(--warn-2)] bg-[var(--warn-2)]/10 text-[var(--warn-2)]',
  recon:           'border-[var(--cy-2)] bg-[var(--cy-3)]/30 text-[var(--cy-1)]',
  'network-scan':  'border-[var(--cy-2)] bg-[var(--cy-3)]/30 text-[var(--cy-1)]',
};

function riskTint(risk: string): string {
  return RISK_TINT[risk.toLowerCase()]
    ?? 'border-[var(--line-2)] bg-[var(--bg-3)] text-[var(--fg-2)]';
}

function StatusBadge({ status }: { status: ApprovalRecord['status'] }) {
  const map: Record<ApprovalRecord['status'], { label: string; variant: 'queued' | 'completed' | 'failed' }> = {
    pending:  { label: '⌛ PENDING',   variant: 'queued' },
    approved: { label: '✓ APPROVED',  variant: 'completed' },
    denied:   { label: '✗ DENIED',    variant: 'failed' },
  };
  const entry = map[status] || map.pending;
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

export function ApprovalCard({
  approval,
  mode = 'list',
  selected = false,
  onClick,
  className,
}: ApprovalCardProps) {
  const risk = String(approval.riskClass || 'unknown').toLowerCase();
  const target = approval.target || 'unspecified';
  const isResolved = approval.status !== 'pending';
  const baseClass = cn(
    'block w-full text-left rounded-lg border border-border bg-card text-card-foreground shadow-sm px-3.5 py-3 transition-colors',
    onClick && 'cursor-pointer hover:border-[var(--cy-2)] hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'border-[var(--cy-2)] bg-[var(--bg-3)]',
    isResolved && 'opacity-75',
    className,
  );

  const body = (
    <>
      <header className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="outline" className="text-[10px]">
            {String(approval.type || 'approval').toUpperCase()}
          </Badge>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]',
              riskTint(risk),
            )}
          >
            {risk.toUpperCase()}
          </span>
          <strong
            className="font-mono text-[12px] text-foreground truncate max-w-[280px]"
            title={target}
          >
            {target}
          </strong>
          <span className="ml-auto" />
          <StatusBadge status={approval.status} />
        </header>

        <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-[12px] mb-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground self-start pt-0.5">
            Action
          </dt>
          <dd>
            <code className="font-mono text-[11px] text-[var(--fg-2)]">{approval.actionClass || '—'}</code>
          </dd>
          <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground self-start pt-0.5">
            Reason
          </dt>
          <dd className="text-foreground break-words">{approval.policyReason || '—'}</dd>
          <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground self-start pt-0.5">
            Effect
          </dt>
          <dd className="text-foreground break-words">{approval.expectedEffect || '—'}</dd>
          {approval.sideEffects && approval.sideEffects.length > 0 ? (
            <>
              <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground self-start pt-0.5">
                Side fx
              </dt>
              <dd>
                <ul className="list-disc pl-4 space-y-0.5 text-[12px] text-[var(--fg-2)]">
                  {approval.sideEffects.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {approval.denialReason ? (
            <>
              <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-destructive self-start pt-0.5">
                Denied
              </dt>
              <dd className="text-destructive break-words">{approval.denialReason}</dd>
            </>
          ) : null}
        </dl>

        {mode === 'detail' ? (
          <details className="rounded-md border border-border bg-[var(--bg-1)] px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-foreground">
              Raw details
            </summary>
            <pre
              className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-[var(--fg-2)]"
              data-testid="approval-raw-json"
            >
              {JSON.stringify(approval.rawDetails ?? approval, null, 2)}
            </pre>
          </details>
        ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-approval-id={approval.id}
        data-approval-status={approval.status}
        className={baseClass}
      >
        {body}
      </button>
    );
  }
  return (
    <article
      data-approval-id={approval.id}
      data-approval-status={approval.status}
      className={baseClass}
    >
      {body}
    </article>
  );
}

export default ApprovalCard;
