// Typed wrappers around /api/onboarding/*  +  React Query hooks.
//
// Mirrors frontend/js/pages/onboarding-checklist.js so the React preview
// surface and the legacy vanilla checklist hit identical endpoints with
// identical JSON shapes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';
import type {
  OnboardingChecklist,
  OnboardingItem,
} from './types';

export const ONBOARDING_ITEMS: ReadonlyArray<OnboardingItem> = [
  {
    id: 'demoLoaded',
    title: 'Load a demo scenario',
    help: 'Quickest path to see PHANTOM populated — synthetic scopes/assets/runs/findings.',
    ctaLabel: 'Load demo',
    ctaAction: 'load-demo',
  },
  {
    id: 'toolpacksInstalled',
    title: 'Install starter toolpacks',
    help: 'Toolpacks bundle the curated security tools PHANTOM gates and traces.',
    ctaLabel: 'Open Settings',
    ctaRoute: 'settings',
  },
  {
    id: 'hasScope',
    title: 'Authorize a scope',
    help: 'A scope bounds what targets PHANTOM may touch and which risk classes are allowed.',
    ctaLabel: 'Draft scope',
    ctaRoute: 'scope',
  },
  {
    id: 'hasAsset',
    title: 'Add an asset',
    help: 'Inventory the hosts/services in-scope. Future: scan your LAN to populate this.',
    ctaLabel: 'Open Assets',
    ctaRoute: 'scope',
  },
  {
    id: 'hasRun',
    title: 'Run a governed task',
    help: 'Either start a chat in a scope, or open Campaigns and launch a first goal.',
    ctaLabel: 'Open Campaigns',
    ctaRoute: 'campaigns',
  },
];

export const onboardingApi = {
  checklist: async (): Promise<OnboardingChecklist> => {
    const data = await apiFetch<OnboardingChecklist>('/api/onboarding/checklist', {
      timeoutMs: 3000,
    });
    if (!data) throw new Error('onboarding checklist missing');
    return data;
  },
  loadDemo: async (reset = false): Promise<unknown> => {
    return apiFetch('/api/onboarding/load-demo', {
      method: 'POST',
      body: JSON.stringify({ reset }),
      timeoutMs: 15000,
    });
  },
  clearDemo: async (): Promise<unknown> => {
    return apiFetch('/api/onboarding/clear-demo', {
      method: 'POST',
      body: JSON.stringify({}),
      timeoutMs: 8000,
    });
  },
};

export function useChecklist() {
  return useQuery({
    queryKey: ['onboarding', 'checklist'],
    queryFn: () => onboardingApi.checklist(),
  });
}

export function useLoadDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reset: boolean = false) => onboardingApi.loadDemo(reset),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

export function useClearDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => onboardingApi.clearDemo(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
