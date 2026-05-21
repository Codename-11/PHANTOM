// Typed wrappers + React Query hooks around the /api/registry/local/*
// REST surface (B1/B2 read-only registry).
//
// Mirrors frontend/js/pages/registry-page.js so the React bundle hits the
// exact same endpoints with the same JSON shapes:
//   - GET  /api/registry/local              → summary + light manifest list
//   - GET  /api/registry/local/:id          → full validated record
//   - POST /api/registry/local/:id/preview-install → declarative plan (no exec)
//
// Types are defined locally (lib/types.ts is owned by another surface and
// must not be edited).

import { useMutation, useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';

// ── Manifest sub-shapes (server/registry/local-manifest-loader.js) ──────

export interface ManifestIdentity {
  id?: string;
  name?: string;
  summary?: string;
  version?: string;
  publisher?: string;
  license?: string;
  category?: string;
}

export interface ManifestRisk {
  action_classes?: string[];
  scope_required?: boolean;
  network_egress?: string;
}

export interface ManifestTool {
  name?: string;
  command?: string;
  risk?: string;
  gated?: boolean;
}

export interface ManifestInstall {
  recipes?: unknown[];
  privileges?: unknown[];
  rollback?: unknown;
  [key: string]: unknown;
}

export interface ManifestTrust {
  digest?: string;
  signature?: string;
  signed_by?: string;
}

export interface ManifestLifecycle {
  deprecated_at?: string;
  replacement?: string;
}

export interface ManifestBody {
  identity?: ManifestIdentity;
  risk?: ManifestRisk;
  tools?: ManifestTool[];
  install?: ManifestInstall;
  trust?: ManifestTrust;
  lifecycle?: ManifestLifecycle;
}

export interface ManifestError {
  path?: string;
  message: string;
}

// Light list item (GET /api/registry/local → manifests[]). The full
// manifest body is stripped server-side; only identity + risk are echoed.
export interface RegistryListItem {
  id: string;
  version: string;
  valid: boolean;
  errorCount: number;
  source: string;
  digest: string | null;
  computedDigest: string | null;
  identity: ManifestIdentity | null;
  risk: ManifestRisk | null;
}

export interface RegistrySummary {
  total: number;
  valid: number;
  invalid: number;
}

export interface RegistryListResponse {
  summary: RegistrySummary;
  manifests: RegistryListItem[];
}

// Full record (GET /api/registry/local/:id).
export interface RegistryManifestRecord {
  id: string;
  version: string;
  valid: boolean;
  errors: ManifestError[];
  manifest: ManifestBody | null;
  digest: string | null;
  computedDigest: string | null;
  source: string;
}

// Declarative preview-install plan (POST .../preview-install).
export interface PreviewInstallPlan {
  recipes: unknown[];
  privileges: unknown[];
  rollback: unknown;
}

export interface PreviewInstallResponse {
  id: string;
  version: string;
  plan: PreviewInstallPlan;
  toolCount: number;
  riskClasses: string[];
  digest: string | null;
  note: string;
}

// ── Trust derivation ────────────────────────────────────────────────────
// Mirrors registry-presenter.trustBadge(): trust is "signed" only when a
// declared digest AND an on-disk digest are both present AND they match;
// any mismatch (or a missing digest) reads as "unsigned".
export type TrustState = 'signed' | 'unsigned';

export function deriveTrust(
  declared: string | null | undefined,
  computed: string | null | undefined,
): TrustState {
  if (declared && computed && declared === computed) return 'signed';
  return 'unsigned';
}

// ── API client ──────────────────────────────────────────────────────────

export const registryApi = {
  list: async (): Promise<RegistryListResponse> => {
    const data = await apiFetch<RegistryListResponse>('/api/registry/local', {
      timeoutMs: 3000,
    });
    return (
      data ?? { summary: { total: 0, valid: 0, invalid: 0 }, manifests: [] }
    );
  },
  get: (id: string): Promise<RegistryManifestRecord> =>
    apiFetch<RegistryManifestRecord>(
      `/api/registry/local/${encodeURIComponent(id)}`,
      { timeoutMs: 3000 },
    ) as Promise<RegistryManifestRecord>,
  previewInstall: (id: string): Promise<PreviewInstallResponse> =>
    apiFetch<PreviewInstallResponse>(
      `/api/registry/local/${encodeURIComponent(id)}/preview-install`,
      { method: 'POST', body: '{}', timeoutMs: 3000 },
    ) as Promise<PreviewInstallResponse>,
};

// ── React Query hooks ─────────────────────────────────────────────────────

export function useRegistryLocal() {
  return useQuery({
    queryKey: ['registry', 'list'],
    queryFn: () => registryApi.list(),
  });
}

export function useRegistryManifest(id: string | null | undefined) {
  return useQuery({
    queryKey: ['registry', 'manifest', id],
    queryFn: () => registryApi.get(id!),
    enabled: Boolean(id),
  });
}

// Preview-install is a POST mutation (the server treats it as a plan
// request, not a cacheable read). Callers fire it once the detail Sheet
// opens; the resulting plan is rendered with a disabled "Request install"
// button until Approvals plumbing lands.
export function usePreviewInstall() {
  return useMutation<PreviewInstallResponse, Error, string>({
    mutationFn: (id) => registryApi.previewInstall(id),
  });
}
