// Standardized page header — single source of truth for the eyebrow +
// title + description + actions row every page repeats. Sizing scale
// (2026-05-21): title text-xl (was text-2xl per-page) for a lighter,
// denser cockpit feel. Change the scale here once, not in 11 files.
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** Small mono uppercase kicker above the title. */
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  /** Right-aligned action buttons. */
  actions?: React.ReactNode;
  /** Extra classes on the <header> (e.g. `mb-4` when no parent space-y). */
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold text-foreground mb-1">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground max-w-2xl">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2 shrink-0">{actions}</div> : null}
    </header>
  );
}

export default PageHeader;
