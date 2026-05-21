// Typed wrappers around /api/approvals + /api/installer/requests* +
// React Query hooks. The Approvals page is the single triage queue for
// every governance-gated action — scope-blocked tool calls,
// install_requests rows, and (future) registry imports.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';
import type {
  ApprovalRecord,
  ApprovalsListResponse,
  InstallRequest,
  InstallRequestsResponse,
} from './types';

export const HIGH_RISK_CLASSES = new Set<string>([
  'exploit',
  'destructive',
  'online-bruteforce',
  'offline-password-audit',
  'credentialed',
]);

export function requiresDenialReason(riskClass: string | null | undefined): boolean {
  return HIGH_RISK_CLASSES.has(String(riskClass || '').toLowerCase());
}

// Aggregate decision stats returned by /api/approvals/stats. Defined
// here (not lib/types.ts) because the Approvals page is the only React
// consumer; mirrors the server/memory/store.js getApprovalStats shape.
export interface ApprovalStats {
  total: number;
  byDecision: Record<string, number>;
  byRisk: Record<string, number>;
  series: Array<{ day: string; count: number }>;
}

const EMPTY_STATS: ApprovalStats = {
  total: 0,
  byDecision: {},
  byRisk: {},
  series: [],
};

export interface ApprovalsBundle {
  // Pending install requests with the explained shape attached.
  pending: ApprovalRecord[];
  // Raw install rows aligned with `pending` by `id` for retry actions.
  rawById: Map<string, InstallRequest>;
  // Decision history (audit) — granted/denied/timeout/etc events.
  history: ApprovalsListResponse;
  // Aggregate decision counts powering the KPI strip.
  stats: ApprovalStats;
}

export const approvalsApi = {
  // Pending install_requests queue. Renders the EXPLAINED shape produced
  // by server/approvals/explain.js.
  pending: async (): Promise<InstallRequestsResponse> => {
    const data = await apiFetch<InstallRequestsResponse | InstallRequest[]>(
      '/api/installer/requests?status=pending&limit=50&explained=1',
    );
    if (Array.isArray(data)) {
      // Old-shape fallback before the explained=1 rollout. Use a minimal
      // synthetic explain shape so the UI still renders sensibly.
      return { requests: data, explained: [] };
    }
    return data ?? { requests: [], explained: [] };
  },
  history: async (): Promise<ApprovalsListResponse> => {
    const data = await apiFetch<ApprovalsListResponse>('/api/approvals?limit=200');
    return data ?? { count: 0, events: [], explained: [] };
  },
  stats: async (): Promise<ApprovalStats> => {
    const data = await apiFetch<ApprovalStats>('/api/approvals/stats');
    return data ?? EMPTY_STATS;
  },
  approveInstall: (id: string) =>
    apiFetch(`/api/installer/requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      timeoutMs: 60_000,
    }),
  denyInstall: (id: string, denialReason: string) =>
    apiFetch(`/api/installer/requests/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ denialReason }),
    }),
};

// Bundled query: pending + history in parallel. The Approvals page
// renders both, the Dash page reads only the counts.
export function useApprovals() {
  return useQuery({
    queryKey: ['approvals', 'pending+history'],
    queryFn: async (): Promise<ApprovalsBundle> => {
      const [pending, history, stats] = await Promise.all([
        approvalsApi.pending(),
        approvalsApi.history(),
        approvalsApi.stats(),
      ]);
      const rawById = new Map<string, InstallRequest>();
      for (const r of pending.requests) rawById.set(r.id, r);
      // Merge explained rows in order, but synthesize a fallback when
      // the server is on the old shape. Keeps the React surface alive
      // during the rollout.
      const explained: ApprovalRecord[] = pending.explained.length
        ? pending.explained
        : pending.requests.map((r) => fallbackInstallExplain(r));
      return {
        pending: explained,
        rawById,
        history,
        stats,
      };
    },
    refetchInterval: 30_000, // keep fresh — gate decisions land out-of-band
  });
}

// Detail helper used by the Approvals drawer (Sheet). We resolve from
// the bundle in cache rather than refetching; bundle stale-time covers
// refresh after approve/deny mutations.
export function useApprovalDetail(id: string | null | undefined) {
  const bundle = useApprovals();
  const found = bundle.data?.pending.find((p) => p.id === id) || null;
  return {
    data: found,
    isLoading: bundle.isLoading,
    isError: bundle.isError,
    error: bundle.error,
  };
}

// Approve / deny mutations. Both invalidate the bundle on success so the
// drawer + list refresh from one source of truth.
export function useApprovalAction(id: string | null | undefined) {
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: () => {
      if (!id) throw new Error('approval id is required');
      return approvalsApi.approveInstall(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  const deny = useMutation({
    mutationFn: (denialReason: string) => {
      if (!id) throw new Error('approval id is required');
      return approvalsApi.denyInstall(id, denialReason);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  return { approve, deny };
}

// ── Fallback explainer ──────────────────────────────────────────────
// When the server hasn't returned `explained=1` yet, synthesize the
// EXPLAINED shape from the raw install request so the UI still renders.
// Matches the fallback in legacy approvals-page.js (kept in sync).
export function fallbackInstallExplain(r: InstallRequest): ApprovalRecord {
  const plan = Array.isArray(r.plan) ? r.plan : [];
  const installable = plan.filter((p) => p?.backend).length;
  const backends = Array.from(new Set(plan.filter((p) => p?.backend).map((p) => p.backend!)));
  const status = r.status === 'pending'
    ? 'pending'
    : r.status === 'cancelled' || r.status === 'failed'
    ? 'denied'
    : 'approved';
  return {
    id: r.id,
    type: 'install',
    target: `packages:${(r.toolIds || []).slice(0, 3).join(',')}`,
    riskClass: 'credentialed',
    actionClass: backends.length === 1 ? `install.${backends[0]}` : 'install.unknown',
    policyReason: `Installing ${installable} security tool${installable === 1 ? '' : 's'} via ${backends.join(' / ') || 'a system package manager'} requires elevated privileges and explicit operator approval.`,
    expectedEffect: `Installs ${installable} security tool${installable === 1 ? '' : 's'}${backends.length ? ` via ${backends.join(' / ')}` : ''}.`,
    sideEffects: [
      'Invokes a system package manager.',
      'Requires elevated privileges (sudo / admin).',
      'Downloads packages from upstream repositories.',
    ],
    rawDetails: r,
    createdAt: r.requested_at,
    status,
    denialReason: r.denial_reason || null,
  };
}
