// Typed wrappers around the /api/artifacts/* REST surface plus React
// Query hooks. Mirrors frontend/js/pages/artifacts-page.js so the React
// preview hits the same endpoints with identical JSON shapes.

import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';
import type { ArtifactRecord, ArtifactFilter } from './types';

interface ListOpts {
  type?: string | null;
  runId?: string | null;
  conversationId?: string | null;
  limit?: number;
}

function buildQuery(opts: ListOpts): string {
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit ?? 100));
  if (opts.type) params.set('type', opts.type);
  if (opts.runId) params.set('runId', opts.runId);
  if (opts.conversationId) params.set('conversationId', opts.conversationId);
  return params.toString();
}

export const artifactsApi = {
  list: async (opts: ListOpts = {}): Promise<ArtifactRecord[]> => {
    const data = await apiFetch<ArtifactRecord[]>(`/api/artifacts?${buildQuery(opts)}`);
    return Array.isArray(data) ? data : [];
  },
  get: async (id: string): Promise<ArtifactRecord> => {
    const data = await apiFetch<ArtifactRecord>(`/api/artifacts/${encodeURIComponent(id)}`);
    if (!data) throw new Error('artifact not found');
    return data;
  },
};

export function useArtifacts(opts: ListOpts = {}) {
  return useQuery({
    queryKey: ['artifacts', 'list', opts],
    queryFn: () => artifactsApi.list(opts),
  });
}

export function useArtifact(id: string | null | undefined) {
  return useQuery({
    queryKey: ['artifacts', 'detail', id],
    queryFn: () => artifactsApi.get(id!),
    enabled: Boolean(id),
  });
}

// ── Filter bucket → underlying `type` predicate ───────────────────────
//
// The operator-friendly chips ("All / Reports / Evidence / Trace /
// Other") group several raw `type` values together. The filter is
// applied client-side after fetch so the chip switching feels instant
// and we don't have to make a new request per chip.
//
// Reports     — markdown reports (pentest report, executive summary,
//               campaign report, etc.).
// Evidence    — run/campaign evidence bundles (zip + redacted markdown
//               + json export).
// Trace       — graph snapshots and jsonl trace dumps.
// Other       — html previews, raw blobs, anything not matched above.

const REPORT_TYPES = new Set(['markdown', 'report']);
const EVIDENCE_TYPES = new Set(['evidence']);
const TRACE_TYPES = new Set(['jsonl', 'json']);

export function matchesArtifactFilter(
  artifact: ArtifactRecord,
  filter: ArtifactFilter,
): boolean {
  if (filter === 'all') return true;
  const type = (artifact.type || '').toLowerCase();
  if (filter === 'reports') return REPORT_TYPES.has(type);
  if (filter === 'evidence') return EVIDENCE_TYPES.has(type);
  if (filter === 'trace') return TRACE_TYPES.has(type);
  // 'other' = everything that didn't match the three buckets above.
  return !REPORT_TYPES.has(type) && !EVIDENCE_TYPES.has(type) && !TRACE_TYPES.has(type);
}

export const ARTIFACT_FILTERS: Array<{ id: ArtifactFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'reports', label: 'Reports' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'trace', label: 'Trace' },
  { id: 'other', label: 'Other' },
];
