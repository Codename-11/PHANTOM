// Typed wrappers around /api/findings + /api/findings/:id/triage  +
// React Query hooks. Mirrors the contract that frontend/js/pages/
// alerts-page.js hits — high|crit dismissal requires a note, the
// server enforces it with HTTP 400 + error code 'dismissal_note_required'.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';
import type {
  FindingHistory,
  FindingRecord,
  FindingSeverity,
  FindingTriageStatus,
} from './types';

const SEV_RANK: Record<string, number> = {
  critical: 5, crit: 5,
  high: 4,
  medium: 3, med: 3,
  low: 2,
  info: 1,
  ok: 0,
};

export function severityRank(sev: string | null | undefined): number {
  return SEV_RANK[String(sev || '').toLowerCase()] ?? 0;
}

export function severityClass(
  sev: string | null | undefined,
): 'crit' | 'high' | 'med' | 'low' | 'info' | 'ok' {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical' || s === 'crit') return 'crit';
  if (s === 'high') return 'high';
  if (s === 'medium' || s === 'med') return 'med';
  if (s === 'low') return 'low';
  if (s === 'ok') return 'ok';
  return 'info';
}

// High/crit dismissals require a dismissal_note (server enforces too).
export function severityRequiresNote(sev: string | null | undefined): boolean {
  const s = severityClass(sev);
  return s === 'crit' || s === 'high';
}

export function parseFindingMeta(f: FindingRecord): Record<string, unknown> {
  const m = f.metadata;
  if (!m) return {};
  if (typeof m === 'string') {
    try { return JSON.parse(m); } catch { return {}; }
  }
  if (typeof m === 'object') return m as Record<string, unknown>;
  return {};
}

export interface FindingsQuery {
  status?: string | null;
  severity?: FindingSeverity | null;
  limit?: number;
}

export const findingsApi = {
  list: async (q: FindingsQuery = {}): Promise<FindingRecord[]> => {
    const params = new URLSearchParams();
    params.set('limit', String(q.limit ?? 200));
    if (q.status) params.set('status', String(q.status));
    if (q.severity) params.set('severity', String(q.severity));
    const data = await apiFetch<FindingRecord[]>(`/api/findings?${params.toString()}`);
    return Array.isArray(data) ? data : [];
  },
  triage: async (
    id: string,
    triageStatus: FindingTriageStatus,
    dismissalNote: string | null = null,
  ): Promise<FindingRecord> => {
    const data = await apiFetch<FindingRecord>(
      `/api/findings/${encodeURIComponent(id)}/triage`,
      {
        method: 'PATCH',
        body: JSON.stringify({ triageStatus, dismissalNote }),
        timeoutMs: 5000,
      },
    );
    if (!data) throw new Error('triage returned no finding');
    return data;
  },
  history: async (id: string): Promise<FindingHistory> => {
    const data = await apiFetch<FindingHistory>(
      `/api/findings/${encodeURIComponent(id)}/history`,
    );
    if (!data) throw new Error('history returned no body');
    return data;
  },
};

export function useFindings(q: FindingsQuery = {}) {
  return useQuery({
    queryKey: ['findings', 'list', q],
    queryFn: () => findingsApi.list(q),
  });
}

// Lifecycle history for a single finding. Disabled until an id is present
// (the History tab only mounts the query once a finding is selected).
export function useFindingHistory(id: string | null | undefined) {
  return useQuery({
    queryKey: ['findings', 'history', id],
    queryFn: () => findingsApi.history(id!),
    enabled: Boolean(id),
  });
}

// Triage mutation. Caller decides which `triageStatus` to send. For
// dismissals the UI prompts for a note via a Dialog and passes it
// through; the server still re-validates.
export function useTriage(id: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<
    FindingRecord,
    Error,
    { triageStatus: FindingTriageStatus; dismissalNote?: string | null }
  >({
    mutationFn: ({ triageStatus, dismissalNote }) => {
      if (!id) throw new Error('finding id is required');
      return findingsApi.triage(id, triageStatus, dismissalNote ?? null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['findings'] });
    },
  });
}
