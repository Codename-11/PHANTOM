// Dependency-free progress bar (CSS width transition). Radix's progress
// pack isn't needed for a determinate bar. Pass value 0..max.
import { cn } from '@/lib/utils';

export interface ProgressProps {
  value: number;
  max?: number;
  className?: string;
  barClassName?: string;
  label?: string;
}

export function Progress({ value, max = 100, className, barClassName, label }: ProgressProps) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-3)]', className)}
    >
      <div
        className={cn(
          'h-full rounded-full bg-[var(--cy-1)] transition-[width] duration-300 ease-out motion-reduce:transition-none',
          barClassName,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default Progress;
