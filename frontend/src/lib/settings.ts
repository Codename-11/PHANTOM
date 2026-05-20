// Typed wrappers around the /api/settings + /api/diagnostics + /api/toolpacks
// REST surfaces. Settings are read+write; diagnostics + toolpacks are
// read-only in this phase (install actions land in a later A6 cleanup).
//
// React Query owns caching upstream; this module just narrows the JSON.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';
import type {
  AppSettings,
  DiagnosticsResult,
  ProviderState,
  SettingsPatch,
  Toolpack,
} from './types';

// ── Settings ──────────────────────────────────────────────────────────

export const settingsApi = {
  get: async (): Promise<AppSettings> => {
    const data = await apiFetch<AppSettings>('/api/settings');
    if (!data) throw new Error('settings endpoint returned no body');
    return data;
  },
  // PUT /api/settings always returns {success, message} — the server
  // mutates one or more rows in the `settings` table and then resetClient()
  // re-reads them on the next GET, so a fresh GET is the source of truth.
  update: async (patch: SettingsPatch): Promise<void> => {
    await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },
};

export function useSettings() {
  return useQuery<AppSettings, Error>({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, SettingsPatch>({
    mutationFn: (patch) => settingsApi.update(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

// ── Diagnostics ───────────────────────────────────────────────────────

export const diagnosticsApi = {
  get: async (): Promise<DiagnosticsResult> => {
    const data = await apiFetch<DiagnosticsResult>('/api/diagnostics');
    if (!data) throw new Error('diagnostics endpoint returned no body');
    return data;
  },
};

export function useDiagnostics() {
  return useQuery<DiagnosticsResult, Error>({
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.get,
  });
}

// ── Toolpacks ─────────────────────────────────────────────────────────

export const toolpacksApi = {
  list: async (): Promise<Toolpack[]> => {
    const data = await apiFetch<Toolpack[] | { toolpacks?: Toolpack[] }>(
      '/api/toolpacks',
    );
    if (Array.isArray(data)) return data;
    return data?.toolpacks ?? [];
  },
};

export function useToolpacks() {
  return useQuery<Toolpack[], Error>({
    queryKey: ['toolpacks'],
    queryFn: toolpacksApi.list,
  });
}

// Toolpack availability bucket — derived from the per-tool .available flag
// that /api/toolpacks/:id/availability returns. /api/toolpacks itself
// doesn't include host availability, so the Settings tab falls back to
// `unknown` until a follow-up wires the per-pack check.
export type ToolpackAvailability = 'available' | 'partial' | 'missing' | 'unknown';

export function deriveToolpackAvailability(pack: Toolpack): ToolpackAvailability {
  const tools = pack.tools ?? [];
  if (!tools.length) return 'unknown';
  const known = tools.filter((t) => typeof t.available === 'boolean');
  if (!known.length) return 'unknown';
  const available = known.filter((t) => t.available).length;
  if (available === known.length) return 'available';
  if (available === 0) return 'missing';
  return 'partial';
}

// ── Provider state derivation ─────────────────────────────────────────
//
// Mirrors the mega-plan A6 spec: surface one of
//   configured | reachable | missing | proxy-backed | failed
// per the active provider. Inputs are an AppSettings + DiagnosticsResult.
// The diagnostics `provider.data` blob carries the live reachability
// signal; the AppSettings answers "is anything configured at all".

interface ProviderDataBlob {
  status?: string;
  reachable?: boolean;
  baseUrl?: string;
  provider?: string;
}

export function deriveProviderState(
  settings: AppSettings | undefined,
  diag: DiagnosticsResult | undefined,
): ProviderState {
  if (!settings) return 'missing';
  // No base URL OR no API key OR provider unset → 'missing'.
  if (!settings.baseUrl || !settings.provider) return 'missing';
  if (!settings.apiKeySet) return 'missing';

  const diagCheck = diag?.checks?.find((c) => c.id === 'provider');
  const data = (diag?.provider ?? {}) as ProviderDataBlob;

  // Hermes proxy bridge — surfaced as a distinct, neutral state so the
  // operator sees that requests are routed through a local sidecar.
  if ((data.baseUrl || settings.baseUrl).includes('127.0.0.1:8648')) {
    return 'proxy-backed';
  }

  if (diagCheck?.status === 'blocked') return 'failed';
  if (diagCheck?.status === 'degraded') return 'failed';
  if (diagCheck?.status === 'ok') return 'reachable';
  // Configured-but-not-yet-probed (or probe missing on this server build).
  return 'configured';
}
