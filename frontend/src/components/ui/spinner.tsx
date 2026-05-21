// Dependency-free loading spinner. Uses Tailwind's core `animate-spin`
// utility (not tailwindcss-animate), so no config change is needed.
// motion-reduce: callers that don't want spin can pass that modifier,
// but the spinner is small and brief; the ring stays visible with the
// animation paused under prefers-reduced-motion.
import { cn } from '@/lib/utils';

export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function Spinner({ size = 14, className, ...props }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
      className={cn('animate-spin motion-reduce:animate-none', className)}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-20"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default Spinner;
