// React Query hooks for campaigns.
//
// The list query, replay query, and reference-data queries all share the
// same `['campaigns']` namespace so lifecycle mutations can invalidate
// every cached view in one shot.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { campaignsApi } from './campaigns';
import type { Campaign, CreateCampaignBody } from './types';

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns', 'list'],
    queryFn: () => campaignsApi.list(),
  });
}

export function useCampaign(id: string | null | undefined) {
  return useQuery({
    queryKey: ['campaigns', 'replay', id],
    queryFn: () => campaignsApi.replay(id!),
    enabled: Boolean(id),
  });
}

export function useReplay(id: string | null | undefined) {
  return useCampaign(id);
}

export function useCampaignRefs() {
  // Parallel fetches with React Query so the create dialog can render
  // synchronously after the four references have loaded. The references
  // are stale-while-revalidate at the queryClient's default 30s.
  const scopes = useQuery({ queryKey: ['scopes'], queryFn: () => campaignsApi.scopes() });
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => campaignsApi.profiles() });
  const toolpacks = useQuery({ queryKey: ['toolpacks'], queryFn: () => campaignsApi.toolpacks() });
  const backends = useQuery({ queryKey: ['backends'], queryFn: () => campaignsApi.backends() });
  return {
    scopes: scopes.data ?? [],
    profiles: profiles.data ?? [],
    toolpacks: toolpacks.data ?? [],
    backends: backends.data ?? [{ id: 'phantom-native' as const, available: true }],
    isLoading:
      scopes.isLoading || profiles.isLoading || toolpacks.isLoading || backends.isLoading,
    error: scopes.error || profiles.error || toolpacks.error || backends.error,
  };
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation<Campaign, Error, CreateCampaignBody>({
    mutationFn: (body) => campaignsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', 'list'] });
    },
  });
}

export type LifecycleAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'run-next'
  | 'report'
  | 'evidence';

export function useLifecycleAction(id: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, LifecycleAction>({
    mutationFn: async (action) => {
      if (!id) throw new Error('campaign id is required');
      switch (action) {
        case 'start':
          return campaignsApi.start(id);
        case 'pause':
          return campaignsApi.pause(id);
        case 'resume':
          return campaignsApi.resume(id);
        case 'cancel':
          return campaignsApi.cancel(id);
        case 'run-next':
          return campaignsApi.runNext(id);
        case 'report':
          return campaignsApi.report(id);
        case 'evidence':
          return campaignsApi.evidence(id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', 'list'] });
      if (id) qc.invalidateQueries({ queryKey: ['campaigns', 'replay', id] });
    },
  });
}
