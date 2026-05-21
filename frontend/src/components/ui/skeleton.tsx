// shadcn/ui Skeleton — used while React Query is loading a list/detail
// the first time.
import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse motion-reduce:animate-none rounded-md bg-[var(--bg-3)]', className)}
      {...props}
    />
  );
}

export { Skeleton };
