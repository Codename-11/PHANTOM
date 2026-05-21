// Page-scoped helpers for the Alerts page: client-side export of the
// currently-filtered findings (CSV + JSON) and a lazy asset fetch hook.
//
// Export is fully client-side — no backend round-trip. Mirrors the
// legacy AlertsPage.exportFiltered() (frontend/js/pages/alerts-page.js)
// which downloaded a JSON blob; this adds a CSV flavour and routes the
// download through a single helper so the page just calls export*.

import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';
import { parseFindingMeta } from './findings';
import type { FindingRecord } from './types';

export type ExportFormat = 'json' | 'csv';

// Columns surfaced in the CSV. Kept flat + stable so the file diffs
// nicely between exports.
const CSV_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'id', label: 'id' },
  { key: 'severity', label: 'severity' },
  { key: 'status', label: 'status' },
  { key: 'triage_status', label: 'triage_status' },
  { key: 'title', label: 'title' },
  { key: 'target', label: 'target' },
  { key: 'assetId', label: 'asset_id' },
  { key: 'runId', label: 'run_id' },
  { key: 'first_seen_at', label: 'first_seen_at' },
  { key: 'last_seen_at', label: 'last_seen_at' },
];

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  // RFC-4180 quoting: wrap if it contains a comma, quote, or newline.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function findingsToCsv(findings: FindingRecord[]): string {
  const header = CSV_COLUMNS.map((c) => c.label).join(',');
  const rows = findings.map((f) => {
    const meta = parseFindingMeta(f);
    const target = (meta.target as string) || (meta.host as string) || '';
    const flat: Record<string, unknown> = {
      ...f,
      target,
    };
    return CSV_COLUMNS.map((c) => csvCell(flat[c.key])).join(',');
  });
  return [header, ...rows].join('\r\n');
}

export function findingsToJson(findings: FindingRecord[]): string {
  return JSON.stringify(findings, null, 2);
}

// Triggers a browser download of `text` as `filename`. Guarded for SSR /
// non-DOM environments. Returns true when a download was kicked off.
export function downloadText(filename: string, mime: string, text: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

// Builds the file + downloads it. Returns the count exported so the
// caller can surface it in a toast.
export function exportFindings(findings: FindingRecord[], format: ExportFormat): number {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (format === 'csv') {
    downloadText(`phantom-alerts-${stamp}.csv`, 'text/csv;charset=utf-8', findingsToCsv(findings));
  } else {
    downloadText(`phantom-alerts-${stamp}.json`, 'application/json', findingsToJson(findings));
  }
  return findings.length;
}

// ── Lazy asset fetch ───────────────────────────────────────────────────
//
// GET /api/assets/:id returns the asset row plus { findings, snapshots }.
// We only surface the core asset fields in the drawer's Asset tab. The
// query stays disabled until `enabled` flips true (tab selected), giving
// us lazy-on-select loading + React Query caching for free.

export interface AssetDetail {
  id?: string;
  name?: string | null;
  identifier?: string | null;
  type?: string | null;
  address?: string | null;
  target?: string | null;
  criticality?: string | null;
  environment?: string | null;
  scope_id?: string | null;
  scopeId?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export function useAsset(assetId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['asset', assetId],
    enabled: Boolean(assetId) && enabled,
    queryFn: async (): Promise<AssetDetail> => {
      const data = await apiFetch<AssetDetail>(`/api/assets/${encodeURIComponent(assetId as string)}`);
      if (!data) throw new Error('asset not found');
      return data;
    },
  });
}
