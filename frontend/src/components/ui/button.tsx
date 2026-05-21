// shadcn/ui Button — adapted to PHANTOM's cool-slate token map.
//
// Variant choices map 1:1 to the legacy .btn classes:
//   default → .btn (neutral)
//   primary → .btn.primary (cyan)
//   ghost   → .btn.ghost
//   destructive → .btn.danger
// `sm` size matches the legacy .btn.sm 28px-tall affordance.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 font-mono',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--bg-3)] text-foreground border border-[var(--line-2)] hover:bg-[var(--bg-4)] hover:border-[var(--line-3)]',
        primary:
          'bg-[var(--cy-3)] text-[var(--cy-fg)] border border-[var(--cy-2)] hover:bg-[var(--cy-2)] hover:text-[var(--bg-0)]',
        ghost:
          'bg-transparent text-foreground border border-transparent hover:bg-[var(--bg-3)] hover:border-[var(--line-2)]',
        destructive:
          'bg-transparent text-destructive border border-destructive/40 hover:bg-destructive/10 hover:border-destructive',
        outline:
          'border border-[var(--line-2)] bg-transparent text-foreground hover:bg-[var(--bg-3)]',
      },
      size: {
        default: 'h-9 px-4 py-2 text-sm',
        sm: 'h-7 rounded px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  // When true, prepends a spinner and disables the button. Cannot be used
  // with asChild (a Slot forwards to a single child, not a spinner+child).
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner className="-ml-0.5" aria-hidden="true" /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
