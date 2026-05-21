// Dash chart data — two read-only aggregates the React Dash renders as
// hand-written inline SVG (no charting lib; bundle guardrail):
//
//   1. Posture sparklines  → GET /api/trending/posture (server/runs/trending.js)
//      Returns a chronological `sparkline[]` of per-run posture scores.
//   2. 14-day risk breakdown → GET /api/approvals/stats
//      (server/memory/store.js getApprovalStats) returns a flat 14-day
//      `series[]` of approval-event counts plus a `byRisk` histogram.
//
// Both are partial-failure tolerant: the query never throws, so the Dash
// charts degrade to an empty state rather than gating the page.

import { useQuery } from '@tanstack/react-query';

import { apiFetch, ApiError } from './api';

async function tryFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError || err instanceof Error) return null;
    return null;
  }
}

// ── /api/trending/posture ────────────────────────────────────────────

export interface PostureSparkPoint {
  runId: string;
  title: string;
  score: number;
  rating: string; // 'strong' | 'fair' | 'weak' | 'unknown'
  delta: number | null;
  endedAt: string | null;
  startedAt: string | null;
  status: string;
  scope: string | null;
}

export interface PostureTrend {
  v: number;
  scopeId: string | null;
  runsConsidered: number;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  sparkline: PostureSparkPoint[];
}

// ── /api/approvals/stats ─────────────────────────────────────────────

export interface ApprovalDaySpark {
  day: string; // ISO date (YYYY-MM-DD)
  count: number;
}

export interface ApprovalStats {
  total: number;
  byDecision: Record<string, number>;
  byRisk: Record<string, number>;
  series: ApprovalDaySpark[]; // last 14 days, oldest first
}

export interface DashChartsState {
  posture: PostureTrend | null;
  approvalStats: ApprovalStats | null;
}

const EMPTY_POSTURE: PostureTrend = {
  v: 1,
  scopeId: null,
  runsConsidered: 0,
  current: null,
  baseline: null,
  delta: null,
  sparkline: [],
};

const EMPTY_STATS: ApprovalStats = {
  total: 0,
  byDecision: {},
  byRisk: {},
  series: [],
};

async function fetchDashCharts(): Promise<DashChartsState> {
  const [posture, approvalStats] = await Promise.all([
    tryFetch(() =>
      apiFetch<PostureTrend>('/api/trending/posture?limit=14&includeRecentRuns=false', {
        timeoutMs: 4000,
      }),
    ),
    tryFetch(() => apiFetch<ApprovalStats>('/api/approvals/stats', { timeoutMs: 4000 })),
  ]);

  return {
    posture: posture ?? EMPTY_POSTURE,
    approvalStats: approvalStats ?? EMPTY_STATS,
  };
}

export function useDashCharts() {
  return useQuery({
    queryKey: ['dash', 'charts'],
    queryFn: fetchDashCharts,
    refetchInterval: 60_000,
  });
}

// Map a posture rating to a CSS token color. Tokens only — never hex.
export function ratingColorVar(rating: string | null | undefined): string {
  switch ((rating || '').toLowerCase()) {
    case 'strong':
      return 'var(--ok-2)';
    case 'fair':
      return 'var(--warn-2)';
    case 'weak':
      return 'var(--danger)';
    default:
      return 'var(--cy-2)';
  }
}
