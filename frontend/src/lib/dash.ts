// useDashState — aggregates the four queries the Dash hero + cockpit
// need (diagnostics, onboarding checklist, campaigns, approvals events),
// and a partial-failure-tolerant deriveAction port of the legacy
// dash-hero.js 5-priority cascade.
//
// The hero MUST stay alive when any of the four sources fail, so each
// fetch swallows its own error and falls through to the next priority.

import { useQueries, useQuery } from '@tanstack/react-query';

import { apiFetch, ApiError } from './api';
import { campaignsApi } from './campaigns';
import { findingsApi } from './findings';
import { onboardingApi } from './onboarding';
import { approvalsApi } from './approvals';
import type {
  ApprovalEvent,
  ApprovalsListResponse,
  Campaign,
  ContinueWhereLeftOff,
  DashHeroAction,
  DiagnosticsResult,
  FindingRecord,
  OnboardingChecklist,
  RunRecord,
  Toolpack,
} from './types';

// Tolerant probe: return null on any failure (timeout, 4xx, 5xx, parse).
async function tryFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); }
  catch (err) {
    if (err instanceof ApiError || err instanceof Error) return null;
    return null;
  }
}

export interface DashState {
  diag: DiagnosticsResult | null;
  checklist: OnboardingChecklist | null;
  campaigns: Campaign[];
  approvalsHistory: ApprovalsListResponse;
  approvalsPending: number;
  findings: FindingRecord[];
  runs: RunRecord[];
}

async function fetchDashState(): Promise<DashState> {
  // Diagnostics + onboarding feed the hero; the rest feed the KPI strip
  // and the cockpit row. All five run in parallel.
  const [diag, checklist, campaigns, approvalsHistory, pendingResp, findings, runs] =
    await Promise.all([
      tryFetch(() => apiFetch<DiagnosticsResult>('/api/diagnostics', { timeoutMs: 1700 })),
      tryFetch(() => onboardingApi.checklist()),
      tryFetch(() => campaignsApi.list()),
      tryFetch(() => approvalsApi.history()),
      tryFetch(() => approvalsApi.pending()),
      tryFetch(() => findingsApi.list({ limit: 50, status: 'open' })),
      tryFetch(() =>
        apiFetch<RunRecord[]>('/api/runs?limit=10').then((r) => (Array.isArray(r) ? r : [])),
      ),
    ]);

  return {
    diag: diag ?? null,
    checklist: checklist ?? null,
    campaigns: campaigns ?? [],
    approvalsHistory: approvalsHistory ?? { count: 0, events: [], explained: [] },
    approvalsPending: pendingResp?.requests?.length ?? 0,
    findings: findings ?? [],
    runs: runs ?? [],
  };
}

export function useDashState() {
  return useQuery({
    queryKey: ['dash', 'state'],
    queryFn: fetchDashState,
    refetchInterval: 60_000,
  });
}

// ── Hero cascade ─────────────────────────────────────────────────────
//
// Pure port of dash-hero.js deriveAction(). Priority order (first match
// wins):
//   1. Diagnostics overall=blocked → "Fix [check.id]"
//   2. Onboarding incomplete       → "Continue setup"
//   3. Pending approvals > 0       → "Review N approvals"
//   4. Active campaign exists      → "Continue [campaign]"
//   5. Else                        → "Start a new campaign"

interface DeriveInput {
  diag: DiagnosticsResult | null;
  checklist: OnboardingChecklist | null;
  campaigns: Campaign[];
  approvalsPending: number;
  // Legacy dash-hero.js consumed the audit `/api/approvals` array and
  // filtered by status==='pending'; the React port short-circuits with
  // `approvalsPending` (count of install_requests with status=pending).
  pendingEvents?: ApprovalEvent[];
}

export function deriveAction({
  diag,
  checklist,
  campaigns,
  approvalsPending,
  pendingEvents,
}: DeriveInput): DashHeroAction {
  // Priority 1: blocked diagnostic check.
  if (diag?.overall === 'blocked') {
    const blocked = (diag.checks || []).find((c) => c.status === 'blocked');
    return {
      eyebrow: 'System blocked',
      title: blocked ? `Fix ${blocked.id}` : 'Fix system error',
      body: blocked?.detail || 'A core check is failing. Open diagnostics to inspect.',
      ctaLabel: 'Open diagnostics',
      ctaRoute: 'settings',
      tone: 'crit',
    };
  }

  // Priority 2: onboarding incomplete (only when we actually have a checklist).
  if (checklist && !checklist.complete) {
    const cl = checklist.checklist || ({} as OnboardingChecklist['checklist']);
    const next = !cl.demoLoaded ? 'Load demo scenario'
      : !cl.toolpacksInstalled ? 'Install starter toolpacks'
      : !cl.hasScope ? 'Authorize a scope'
      : !cl.hasAsset ? 'Add an asset'
      : !cl.hasRun ? 'Run a governed task'
      : 'Finish setup';
    return {
      eyebrow: 'Get started',
      title: next,
      body: "PHANTOM isn't set up yet. The Dash checklist below walks you through what's left.",
      ctaLabel: 'See checklist',
      ctaScroll: 'onboarding-checklist',
      tone: 'cy',
    };
  }

  // Priority 3: pending approvals. Caller may pass either a numeric
  // count or the raw pending event list (legacy shape).
  const pendingCount = approvalsPending > 0
    ? approvalsPending
    : (pendingEvents || []).filter((e) => (e as { status?: string }).status === 'pending' || (e.decision && e.decision === 'pending')).length;
  if (pendingCount > 0) {
    return {
      eyebrow: 'Awaiting your decision',
      title: `Review ${pendingCount} approval${pendingCount === 1 ? '' : 's'}`,
      body: 'High-risk actions are paused for your decision.',
      ctaLabel: 'Open approvals',
      ctaRoute: 'approvals',
      tone: 'warn',
    };
  }

  // Priority 4: active campaign.
  const active = campaigns.find((c) => c.status === 'running')
    || campaigns.find((c) => c.status === 'needs_approval')
    || campaigns.find((c) => c.status === 'paused');
  if (active) {
    return {
      eyebrow: 'Active campaign',
      title: `Continue ${active.title}`,
      body: active.objective ? active.objective.slice(0, 160) : '',
      ctaLabel: 'Open campaign',
      ctaRoute: 'campaigns',
      tone: 'cy',
    };
  }

  // Priority 5: default.
  return {
    eyebrow: 'Ready',
    title: 'Start a new campaign',
    body: 'Campaigns scope a governed multi-run objective. The supervisor owns budgets, policy, and evidence.',
    ctaLabel: 'New campaign',
    ctaRoute: 'campaigns',
    tone: 'cy',
  };
}

// ── Toolpack readiness ────────────────────────────────────────────────
//
// /api/toolpacks (list) ships the pack metadata but NOT host availability.
// /api/toolpacks/:id/availability re-hydrates each pack's `tools[]` with an
// `{available: boolean}` flag derived from a $PATH lookup on the server.
// We fan out one availability query per pack id so the Dash toolpacks panel
// can render a real readiness dot instead of "unknown".

export type ToolpackReadiness = 'ready' | 'partial' | 'missing' | 'unknown';

// Collapse a hydrated pack's per-tool `.available` flags into one bucket.
export function readinessFromTools(tools: Toolpack['tools']): ToolpackReadiness {
  const list = tools ?? [];
  const known = list.filter((t) => typeof t.available === 'boolean');
  if (known.length === 0) return 'unknown';
  const up = known.filter((t) => t.available).length;
  if (up === known.length) return 'ready';
  if (up === 0) return 'missing';
  return 'partial';
}

export interface ToolpackReadinessState {
  readiness: ToolpackReadiness;
  isLoading: boolean;
  isError: boolean;
}

// Fetch availability for a set of toolpack ids and return a per-id readiness
// map. Each id is an independent query (tolerant: an errored probe degrades
// to `unknown` for that one pack without blocking the others).
export function useToolpackReadiness(ids: string[]): Record<string, ToolpackReadinessState> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['toolpacks', 'availability', id],
      queryFn: () => apiFetch<Toolpack>(`/api/toolpacks/${encodeURIComponent(id)}/availability`),
      staleTime: 30_000,
    })),
  });

  const map: Record<string, ToolpackReadinessState> = {};
  ids.forEach((id, i) => {
    const r = results[i];
    map[id] = {
      readiness: r?.data ? readinessFromTools(r.data.tools) : 'unknown',
      isLoading: Boolean(r?.isLoading),
      isError: Boolean(r?.isError),
    };
  });
  return map;
}

// localStorage payload — same key the legacy bundle writes.
export function readContinueWhereLeftOff(): ContinueWhereLeftOff | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('phantom_last_seen');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ContinueWhereLeftOff;
    if (!parsed || !parsed.kind || !parsed.id || !parsed.label) return null;
    return parsed;
  } catch {
    return null;
  }
}
