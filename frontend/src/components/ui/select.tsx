// Lightweight native-select wrapper, styled to match the shadcn surface.
//
// For A8.1 the campaign-create form only ever needs a plain `<select>`
// (scopes + prompt profiles). Pulling in the full Radix Select primitive
// would balloon the bundle for zero UX benefit, so we ship a styled
// native control instead. Callers still get a forwardRef, className
// override, and the same border/focus tokens every other form field uses.
import * as React from 'react';

import { cn } from '@/lib/utils';

const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative w-full">
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full appearance-none rounded-md border border-[var(--line-2)] bg-[var(--bg-1)] px-3 pr-8 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--fg-3)]"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
});
Select.displayName = 'Select';

export { Select };
