// SeverityBadge — kit `.badge` per finding severity. Renders the kit's
// mono-uppercase severity pill (with a status dot) using the restored
// --sev-* token palette, so crit/high/med/low/info/ok all read with the
// concept's color semantics rather than the reduced A8.1 subset.
//
// Keeps the data-severity attribute + uppercase label contract that
// downstream surfaces and tests target.
import { cn } from '@/lib/utils';
import { severityClass } from '@/lib/findings';

interface SeverityBadgeProps {
  severity: string | null | undefined;
  /** show the leading status dot (kit default). */
  dot?: boolean;
  className?: string;
}

const LABEL: Record<'crit' | 'high' | 'med' | 'low' | 'info' | 'ok', string> = {
  crit: 'CRIT',
  high: 'HIGH',
  med: 'MED',
  low: 'LOW',
  info: 'INFO',
  ok: 'OK',
};

export function SeverityBadge({ severity, dot = true, className }: SeverityBadgeProps) {
  const cls = severityClass(severity);
  return (
    <span
      data-severity={cls}
      data-testid="severity-badge"
      className={cn('badge', cls, className)}
    >
      {dot ? <i className="dot" aria-hidden="true" /> : null}
      {LABEL[cls]}
    </span>
  );
}

export default SeverityBadge;
