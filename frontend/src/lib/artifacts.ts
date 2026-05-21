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

// Cap the inline text preview so a huge jsonl/markdown dump can't blow up
// the DOM (mirrors the legacy 20k-char clamp in artifacts-page.js).
export const TEXT_PREVIEW_LIMIT = 20000;

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
  // Fetches the raw artifact body for the inline text/markdown/json preview.
  // contentUrl serves the file with its own mime type; apiFetch returns the
  // raw string for any non-JSON body, so we get text back either way. The
  // result is clamped to TEXT_PREVIEW_LIMIT chars before it hits the DOM.
  content: async (contentUrl: string): Promise<string> => {
    const data = await apiFetch<unknown>(contentUrl);
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return text.length > TEXT_PREVIEW_LIMIT
      ? `${text.slice(0, TEXT_PREVIEW_LIMIT)}\n… truncated …`
      : text;
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

// Fetches the raw text body for an artifact so it can be shown in a <pre>.
// Only enabled when `enabled` is true (i.e. the artifact previews as text)
// so we don't pull binary/iframe content into memory as a string.
export function useArtifactText(contentUrl: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['artifacts', 'content', contentUrl],
    queryFn: () => artifactsApi.content(contentUrl!),
    enabled: Boolean(contentUrl) && enabled,
  });
}

// ── Preview-kind classifier ───────────────────────────────────────────
//
// Decides how an artifact renders in the inline preview pane. `iframe`
// (sandboxed) for html, `image` for image/* mime types, otherwise `text`
// — text/markdown/json/jsonl all fetch the body and show it in a <pre>.
// Anything we can't confidently render inline falls through to `text`,
// which degrades to an Open-in-tab prompt if the fetch fails.
export type ArtifactPreviewKind = 'iframe' | 'image' | 'text';

export function previewKind(artifact: ArtifactRecord): ArtifactPreviewKind {
  const type = (artifact.type || '').toLowerCase();
  const mime = (artifact.mimeType || '').toLowerCase();
  if (type === 'html' || mime === 'text/html' || mime === 'application/pdf') return 'iframe';
  if (mime.startsWith('image/')) return 'image';
  return 'text';
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
