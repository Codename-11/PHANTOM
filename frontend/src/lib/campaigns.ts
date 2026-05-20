// Typed wrappers around the /api/campaigns/* REST surface.
//
// Mirrors frontend/js/campaigns/campaign-client.js so the React bundle
// hits the exact same endpoints with the same JSON shapes — the legacy
// page and the React preview share the server contract until A8.5
// deletes the vanilla bundle.

import { apiFetch } from './api';
import type {
  Campaign,
  CampaignReplay,
  CampaignListResponse,
  CampaignBackendsResponse,
  BackendDescriptor,
  Scope,
  PromptProfile,
  Toolpack,
  CreateCampaignBody,
  Artifact,
} from './types';

interface CreateResponse {
  campaign: Campaign;
}

interface ArtifactResponse {
  artifact: Artifact;
}

interface ScopesResponse { scopes?: Scope[] }
interface ProfilesResponse { profiles?: PromptProfile[] }
interface ToolpacksResponse { toolpacks?: Toolpack[] }

export const campaignsApi = {
  list: async (): Promise<Campaign[]> => {
    const data = await apiFetch<CampaignListResponse>('/api/campaigns');
    return data?.campaigns ?? [];
  },
  backends: async (): Promise<BackendDescriptor[]> => {
    const data = await apiFetch<CampaignBackendsResponse>('/api/campaigns/backends');
    return data?.backends ?? [];
  },
  scopes: async (): Promise<Scope[]> => {
    const data = await apiFetch<ScopesResponse | Scope[]>('/api/scopes');
    if (Array.isArray(data)) return data;
    return data?.scopes ?? [];
  },
  profiles: async (): Promise<PromptProfile[]> => {
    const data = await apiFetch<ProfilesResponse | PromptProfile[]>('/api/prompts/profiles');
    if (Array.isArray(data)) return data;
    return data?.profiles ?? [];
  },
  toolpacks: async (): Promise<Toolpack[]> => {
    const data = await apiFetch<ToolpacksResponse | Toolpack[]>('/api/toolpacks');
    if (Array.isArray(data)) return data;
    return data?.toolpacks ?? [];
  },
  create: async (body: CreateCampaignBody): Promise<Campaign> => {
    const data = await apiFetch<CreateResponse>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!data?.campaign) throw new Error('create returned no campaign');
    return data.campaign;
  },
  get: (id: string): Promise<{ campaign: Campaign }> =>
    apiFetch<{ campaign: Campaign }>(`/api/campaigns/${id}`) as Promise<{ campaign: Campaign }>,
  replay: (id: string): Promise<CampaignReplay> =>
    apiFetch<CampaignReplay>(`/api/campaigns/${id}/replay`) as Promise<CampaignReplay>,
  start: (id: string) =>
    apiFetch(`/api/campaigns/${id}/start`, { method: 'POST', body: '{}' }),
  pause: (id: string) =>
    apiFetch(`/api/campaigns/${id}/pause`, { method: 'POST', body: '{}' }),
  resume: (id: string) =>
    apiFetch(`/api/campaigns/${id}/resume`, { method: 'POST', body: '{}' }),
  cancel: (id: string) =>
    apiFetch(`/api/campaigns/${id}/cancel`, { method: 'POST', body: '{}' }),
  runNext: (id: string) =>
    apiFetch(`/api/campaigns/${id}/run-next`, { method: 'POST' }),
  report: async (id: string): Promise<Artifact> => {
    const data = await apiFetch<ArtifactResponse>(
      `/api/campaigns/${id}/artifacts/report`,
      { method: 'POST', body: '{}' },
    );
    if (!data?.artifact) throw new Error('report returned no artifact');
    return data.artifact;
  },
  evidence: async (id: string): Promise<Artifact> => {
    const data = await apiFetch<ArtifactResponse>(
      `/api/campaigns/${id}/artifacts/evidence-bundle`,
      { method: 'POST', body: '{}' },
    );
    if (!data?.artifact) throw new Error('evidence returned no artifact');
    return data.artifact;
  },
};

// ── Risk class taxonomy (mirrors campaign-form.js) ────────────────────

export interface RiskClass {
  id: string;
  risk: 'low' | 'med' | 'high' | 'crit';
  label: string;
  warn?: boolean;
  locked?: boolean;
}

export const RISK_CLASSES: ReadonlyArray<RiskClass> = [
  { id: 'read/local', risk: 'low', label: 'Read / local' },
  { id: 'recon', risk: 'low', label: 'Recon' },
  { id: 'network-scan', risk: 'med', label: 'Network scan' },
  { id: 'web-vuln', risk: 'high', label: 'Web vuln (passive)' },
  { id: 'offline-password-audit', risk: 'med', label: 'Offline password audit' },
  { id: 'credentialed', risk: 'high', label: 'Credentialed', warn: true },
  { id: 'online-bruteforce', risk: 'high', label: 'Online brute force', warn: true },
  { id: 'exploit', risk: 'crit', label: 'Exploit', locked: true },
  { id: 'destructive', risk: 'crit', label: 'Destructive', locked: true },
];

export const SCOPE_REQUIRED = new Set<string>([
  'recon',
  'network-scan',
  'web-vuln',
  'credentialed',
  'online-bruteforce',
]);
