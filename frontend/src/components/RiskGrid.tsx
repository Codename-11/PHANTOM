// Risk-class checkbox grid. Replaces the legacy `.cf-risk-grid` so the
// create-form lets operators pick which risk classes the campaign is
// authorized to run. Critical classes (exploit + destructive) stay
// locked off — clicking the row is a no-op and the row renders with a
// 'locked · deny' tag.
//
// onChange receives the new allowed set; the parent owns the state.
//
// Presentation: the kit's allow/deny action-class matrix. Each row carries a
// `.badge` severity tag (token-driven, not ad-hoc Tailwind borders); locked
// rows (exploit, destructive) render with the governance `.badge.policy`
// "locked · deny" tag and a tinted left edge so they read as policy-pinned.
import { useId } from 'react';

import { Checkbox } from './ui/checkbox';
import { RISK_CLASSES, type RiskClass } from '@/lib/campaigns';
import { cn } from '@/lib/utils';

interface RiskGridProps {
  allowed: string[];
  onChange: (allowed: string[]) => void;
  className?: string;
}

// Map our 4 risk levels onto the kit's severity `.badge` variants.
const RISK_BADGE: Record<RiskClass['risk'], string> = {
  low: 'badge low',
  med: 'badge med',
  high: 'badge high',
  crit: 'badge crit',
};

export function RiskGrid({ allowed, onChange, className }: RiskGridProps) {
  const allowedSet = new Set(allowed);
  const gridId = useId();

  const toggle = (id: string, locked: boolean | undefined, next: boolean) => {
    if (locked) return;
    const updated = new Set(allowedSet);
    if (next) updated.add(id);
    else updated.delete(id);
    onChange(Array.from(updated));
  };

  return (
    <div
      role="group"
      aria-labelledby={`${gridId}-label`}
      className={cn('grid grid-cols-1 md:grid-cols-2 gap-2', className)}
      data-testid="risk-grid"
    >
      {RISK_CLASSES.map((r) => {
        const isOn = allowedSet.has(r.id);
        const locked = !!r.locked;
        const checked = isOn && !locked;
        const cbId = `${gridId}-${r.id.replace(/[^a-z0-9]/gi, '-')}`;
        return (
          <label
            key={r.id}
            htmlFor={cbId}
            className={cn(
              'flex items-center gap-2 rounded-[var(--r-3)] border border-[var(--line-1)] bg-[var(--bg-2)] px-2.5 py-1.5 transition-colors text-sm',
              checked && 'border-[var(--line-cy)] bg-[var(--cy-tint)]',
              locked && 'cursor-not-allowed border-[var(--policy-line)] bg-[var(--policy-bg)]',
              !locked && 'cursor-pointer hover:border-[var(--line-3)]',
            )}
            data-risk-id={r.id}
            data-locked={locked || undefined}
            data-allowed={checked || undefined}
          >
            <Checkbox
              id={cbId}
              checked={checked}
              disabled={locked}
              onCheckedChange={(next) => toggle(r.id, locked, next === true)}
              data-cf-risk={r.id}
              aria-label={r.label}
            />
            <span
              className={cn(
                'font-mono text-xs',
                locked ? 'text-[var(--fg-3)] line-through' : 'text-foreground',
              )}
            >
              {r.label}
            </span>
            <span className={RISK_BADGE[r.risk]} data-risk-tick={r.risk}>
              {r.risk}
            </span>
            {r.warn && !locked ? (
              <span
                className="ml-auto badge med"
                title="Requires explicit operator approval"
              >
                approval-only
              </span>
            ) : null}
            {locked ? (
              <span className="ml-auto badge policy">locked · deny</span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
