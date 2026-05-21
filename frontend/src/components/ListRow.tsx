// Shared list-row affordance. Replaces 5 near-identical hand-rolled row
// buttons (Alerts FindingRow, Campaigns, Runs, Scope rows, ApprovalCard)
// that each repeated the same border + hover + focus-ring class string.
//
// Render as a real <button> (default) for onClick rows, or pass asChild
// to wrap a react-router <Link> for navigational rows:
//
//   <ListRow onClick={open}>…</ListRow>
//   <ListRow asChild><Link to="/runs/123">…</Link></ListRow>
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/lib/utils';

const ROW_BASE =
  'block w-full text-left rounded-md border border-border bg-card text-card-foreground px-3.5 py-3 transition-colors hover:border-[var(--cy-2)] hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none';

export interface ListRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export const ListRow = React.forwardRef<HTMLButtonElement, ListRowProps>(
  ({ asChild = false, className, type, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(ROW_BASE, className)}
        {...(asChild ? {} : { type: type ?? 'button' })}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
ListRow.displayName = 'ListRow';

export { ROW_BASE };
export default ListRow;
