// Typed wrappers around the /api/scopes/* REST surface.
//
// Mirrors the legacy frontend/js/pages/scope-page.js fetch sites so the
// React preview hits the exact same endpoints with the same JSON shapes.
// The legacy /scope page continues to use these endpoints untouched
// until A8.5 deletes the vanilla bundle.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';
import type { RoeTemplate, ScopeAssetOption } from './scopeBuilder';
import type {
  ParseTargetsResponse,
  ScopeRecord,
  ScopeStatus,
  ScopeTemplate,
} from './types';

export interface CreateScopeBody {
  name: string;
  targets: {
    hosts?: string[];
    domains?: string[];
    cidrs?: string[];
    urls?: string[];
    assetIds?: string[];
  };
  allowedActions: string[];
  blockedActions: string[];
  // Canonical three-state matrix. The server derives nothing from it that it
  // can't also derive from allowedActions/blockedActions, but storing it
  // preserves the 'ask' tier (which neither CSV array can represent).
  actionModes?: Record<string, 'auto' | 'ask' | 'deny'> | null;
  rulesOfEngagement?: string;
  notes?: string;
  expiresAt?: string | null;
}

export const scopesApi = {
  list: async (): Promise<ScopeRecord[]> => {
    const data = await apiFetch<ScopeRecord[] | { scopes?: ScopeRecord[] }>(
      '/api/scopes',
    );
    if (Array.isArray(data)) return data;
    return data?.scopes ?? [];
  },
  get: async (id: string): Promise<ScopeRecord> => {
    const data = await apiFetch<ScopeRecord>(
      `/api/scopes/${encodeURIComponent(id)}`,
    );
    if (!data) throw new Error('scope not found');
    return data;
  },
  templates: async (): Promise<ScopeTemplate[]> => {
    const data = await apiFetch<ScopeTemplate[] | { templates?: ScopeTemplate[] }>(
      '/api/scopes/templates',
    );
    if (Array.isArray(data)) return data;
    return data?.templates ?? [];
  },
  roeTemplates: async (): Promise<RoeTemplate[]> => {
    const data = await apiFetch<{ templates?: RoeTemplate[] } | RoeTemplate[]>(
      '/api/scopes/roe-templates',
    );
    if (Array.isArray(data)) return data;
    return data?.templates ?? [];
  },
  assets: async (): Promise<ScopeAssetOption[]> => {
    const data = await apiFetch<ScopeAssetOption[] | { assets?: ScopeAssetOption[] }>(
      '/api/assets?limit=100',
    );
    if (Array.isArray(data)) return data;
    return data?.assets ?? [];
  },
  parseTargets: async (input: string): Promise<ParseTargetsResponse> => {
    const data = await apiFetch<ParseTargetsResponse>(
      '/api/scopes/parse-targets',
      {
        method: 'POST',
        body: JSON.stringify({ input }),
      },
    );
    if (!data) throw new Error('parse-targets returned no body');
    return data;
  },
  create: async (body: CreateScopeBody): Promise<ScopeRecord> => {
    const data = await apiFetch<ScopeRecord>('/api/scopes', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!data) throw new Error('create scope returned no body');
    return data;
  },
};

export function useScopes() {
  return useQuery<ScopeRecord[], Error>({
    queryKey: ['scopes'],
    queryFn: scopesApi.list,
  });
}

export function useScope(id: string | undefined) {
  return useQuery<ScopeRecord, Error>({
    queryKey: ['scope', id],
    queryFn: () => scopesApi.get(id as string),
    enabled: !!id,
  });
}

// Reference data for the full builder. These are static-ish catalogues, so
// they cache aggressively and never auto-refetch on focus.
export function useScopeTemplates() {
  return useQuery<ScopeTemplate[], Error>({
    queryKey: ['scope-templates'],
    queryFn: scopesApi.templates,
    staleTime: 5 * 60_000,
  });
}

export function useRoeTemplates() {
  return useQuery<RoeTemplate[], Error>({
    queryKey: ['scope-roe-templates'],
    queryFn: scopesApi.roeTemplates,
    staleTime: 5 * 60_000,
  });
}

export function useScopeAssets() {
  return useQuery<ScopeAssetOption[], Error>({
    queryKey: ['scope-assets'],
    queryFn: scopesApi.assets,
    staleTime: 60_000,
  });
}

export function useCreateScope() {
  const queryClient = useQueryClient();
  return useMutation<ScopeRecord, Error, CreateScopeBody>({
    mutationFn: (body) => scopesApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scopes'] });
    },
  });
}

// ── Status derivation ─────────────────────────────────────────────────
//
// /api/scopes doesn't ship a status field — it ships archived_at and
// expires_at. Derive a tri-state status here so the ScopePill component
// has a stable, typed input.
export function deriveScopeStatus(scope: ScopeRecord): ScopeStatus {
  if (scope.archived_at) return 'archived';
  if (scope.expires_at) {
    const exp = Date.parse(scope.expires_at);
    if (!Number.isNaN(exp) && exp < Date.now()) return 'expired';
  }
  return 'active';
}

// Convenience: count the number of unique targets across all categories.
// Used by the list rows so operators see scope "size" at a glance.
export function countScopeTargets(scope: ScopeRecord): number {
  const t = scope.targets || {};
  return (
    (t.hosts?.length ?? 0) +
    (t.domains?.length ?? 0) +
    (t.cidrs?.length ?? 0) +
    (t.urls?.length ?? 0) +
    (t.hostPorts?.length ?? 0)
  );
}
