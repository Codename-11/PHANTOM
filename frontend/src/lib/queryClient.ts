// Shared React Query client.
//
// 30s stale time matches the cadence at which PHANTOM's vanilla pages
// already re-poll diagnostics/runs/campaigns lists; longer would risk
// showing the operator outdated readiness/approval counts.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // ApiError instances carry an explicit retryable flag; honor it.
        const retryable = (error as { retryable?: boolean } | null)?.retryable;
        if (retryable === false) return false;
        return failureCount < 2;
      },
    },
  },
});
