// Dependency-free tooltip. Radix's tooltip pack is avoided per the
// bundle guardrail; this covers the 90% case (hover + keyboard focus,
// aria-describedby wiring) without floating-ui positioning. Position is
// fixed to one side via the `side` prop. For rich/interactive popovers
// use a Sheet/Dialog instead.
import * as React from 'react';

import { cn } from '@/lib/utils';

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: React.ReactNode;
  side?: Side;
  children: React.ReactElement;
  className?: string;
}

const sidePos: Record<Side, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

let tipCounter = 0;

export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useMemo(() => `tt-${++tipCounter}`, []);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {React.cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'absolute z-[150] whitespace-nowrap rounded-md border border-border bg-[var(--bg-4)] px-2 py-1 text-[11px] text-foreground shadow-lg',
            'animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none',
            sidePos[side],
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

export default Tooltip;
