// shadcn/ui Badge — extended with PHANTOM campaign-pill variants so the
// list/detail surfaces render identically to the legacy `.campaign-pill-*`
// classes. The variant prop accepts the canonical campaign status values
// (draft/queued/running/paused/needs_approval/completed/failed/canceled)
// plus the kit's neutral/primary/destructive defaults.
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-[var(--line-2)] bg-[var(--bg-3)] text-[var(--fg-2)]',
        primary: 'border-[var(--cy-2)] bg-[var(--cy-3)] text-[var(--cy-fg)]',
        destructive: 'border-destructive bg-transparent text-destructive',
        outline: 'border-[var(--line-2)] bg-transparent text-[var(--fg-2)]',
        // ── Campaign-pill states ────────────────────────────────────────
        draft: 'border-[var(--line-2)] bg-[var(--bg-3)] text-[var(--fg-3)]',
        queued: 'border-[var(--line-2)] bg-[var(--bg-3)] text-[var(--cy-2)]',
        running:
          'border-[var(--cy-2)] bg-[var(--cy-3)]/30 text-[var(--cy-1)]',
        paused: 'border-[var(--line-2)] bg-[var(--bg-3)] text-[var(--fg-2)]',
        needs_approval:
          'border-[var(--warn-2)] bg-[var(--bg-3)] text-[var(--warn-2)]',
        completed:
          'border-[var(--ok-2)] bg-[var(--bg-3)] text-[var(--ok-2)]',
        failed: 'border-destructive bg-[var(--bg-3)] text-destructive',
        canceled: 'border-[var(--fg-3)] bg-[var(--bg-3)] text-[var(--fg-3)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
