// Typed wrappers around the /api/runs/* REST surface plus React Query
// hooks. Mirrors the contract that frontend/js/pages/runs-page.js hits
// against the same endpoints — the React preview and the legacy vanilla
// page share the server side until A8.5 deletes the vanilla bundle.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';
import type {
  RunRecord,
  TraceEvent,
  EvidenceBundle,
  ArtifactRecord,
} from './types';

export const runsApi = {
  list: async (): Promise<RunRecord[]> => {
    const data = await apiFetch<RunRecord[]>('/api/runs?limit=50');
    return Array.isArray(data) ? data : [];
  },
  get: async (id: string): Promise<RunRecord & { events?: TraceEvent[]; artifacts?: ArtifactRecord[] }> => {
    const data = await apiFetch<RunRecord & { events?: TraceEvent[]; artifacts?: ArtifactRecord[] }>(
      `/api/runs/${encodeURIComponent(id)}`,
    );
    if (!data) throw new Error('run not found');
    return data;
  },
  events: async (id: string): Promise<TraceEvent[]> => {
    const data = await apiFetch<TraceEvent[]>(`/api/runs/${encodeURIComponent(id)}/events?limit=500`);
    return Array.isArray(data) ? data : [];
  },
  evidence: async (id: string): Promise<EvidenceBundle> => {
    const data = await apiFetch<EvidenceBundle>(`/api/runs/${encodeURIComponent(id)}/evidence`);
    if (!data) throw new Error('evidence bundle missing');
    return data;
  },
  exportEvidence: async (id: string, format: 'markdown' | 'json'): Promise<ArtifactRecord> => {
    const data = await apiFetch<ArtifactRecord>(
      `/api/runs/${encodeURIComponent(id)}/evidence/export`,
      { method: 'POST', body: JSON.stringify({ format }) },
    );
    if (!data) throw new Error('export returned no artifact');
    return data;
  },
};

export function useRuns() {
  return useQuery({
    queryKey: ['runs', 'list'],
    queryFn: () => runsApi.list(),
  });
}

export function useRun(id: string | null | undefined) {
  return useQuery({
    queryKey: ['runs', 'detail', id],
    queryFn: () => runsApi.get(id!),
    enabled: Boolean(id),
  });
}

export function useRunEvents(id: string | null | undefined) {
  return useQuery({
    queryKey: ['runs', 'events', id],
    queryFn: () => runsApi.events(id!),
    enabled: Boolean(id),
  });
}

export function useRunEvidence(id: string | null | undefined) {
  return useQuery({
    queryKey: ['runs', 'evidence', id],
    queryFn: () => runsApi.evidence(id!),
    enabled: Boolean(id),
  });
}

export function useExportEvidence(id: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<ArtifactRecord, Error, 'markdown' | 'json'>({
    mutationFn: (format) => {
      if (!id) throw new Error('run id is required');
      return runsApi.exportEvidence(id, format);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artifacts'] });
    },
  });
}
