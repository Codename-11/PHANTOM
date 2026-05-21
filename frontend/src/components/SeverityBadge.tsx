// SeverityBadge — Badge variant per finding severity. Mirrors the
// legacy `.sev-badge.crit/.high/.med/.low/.info` color tokens, keeps
// the cool-slate palette intact (red for crit, amber for high, etc).
import { cn } from '@/lib/utils';
import { severityClass } from '@/lib/findings';

interface SeverityBadgeProps {
  severity: string | null | undefined;
  className?: string;
}

const STYLES: Record<'crit' | 'high' | 'med' | 'low' | 'info', string> = {
  crit: 'border-destructive bg-destructive/10 text-destructive',
  high: 'border-[var(--warn-2)] bg-[var(--warn-2)]/10 text-[var(--warn-2)]',
  med:  'border-[var(--cy-2)] bg-[var(--cy-3)]/30 text-[var(--cy-1)]',
  low:  'border-[var(--ok-2)] bg-[var(--ok-2)]/10 text-[var(--ok-2)]',
  info: 'border-[var(--line-2)] bg-[var(--bg-3)] text-[var(--fg-3)]',
};

const LABEL: Record<'crit' | 'high' | 'med' | 'low' | 'info', string> = {
  crit: 'CRIT',
  high: 'HIGH',
  med:  'MED',
  low:  'LOW',
  info: 'INFO',
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const cls = severityClass(severity);
  return (
    <span
      data-severity={cls}
      data-testid="severity-badge"
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]',
        STYLES[cls],
        className,
      )}
    >
      {LABEL[cls]}
    </span>
  );
}

export default SeverityBadge;
