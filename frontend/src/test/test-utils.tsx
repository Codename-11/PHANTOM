// Renders a React tree with a fresh QueryClient + MemoryRouter so each
// test gets isolated React Query state and a controllable URL.
import { ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { ToastProvider } from '@/components/ui/toast';

interface Options extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  queryClient?: QueryClient;
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(ui: ReactNode, opts: Options = {}) {
  const queryClient = opts.queryClient ?? makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[opts.route ?? '/']}>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return {
    queryClient,
    ...render(<>{ui}</>, { ...opts, wrapper }),
  };
}
