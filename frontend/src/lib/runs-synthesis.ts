// Typed wrapper + React Query hook for the LLM-enriched end-of-run
// synthesis card. Kept in its own module (not lib/runs.ts) so the A8.5b
// Runs parity-close stays conflict-free with parallel agents.
//
// Endpoint: GET /api/runs/:id/synthesis
//   - Returns the canonical v1 synthesis shape from server/runs/synthesis.js
//     (buildRunSynthesis). When the operator has `synthesis_llm_enabled`
//     turned on, highlights[] + nextSteps[] are rewritten by the model and
//     an `enrichment` marker is attached; the numbers are unchanged.
//   - ?preview=stub serves a hand-tuned sample (onboarding wizard).
//
// We declare the shape locally rather than touch the shared lib/types.ts.

import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';

export type SynthesisRating = 'strong' | 'fair' | 'weak' | 'unknown';
export type ObjectiveMet = 'met' | 'partial' | 'unmet' | 'unknown';
export type HighlightKind = 'win' | 'risk' | 'note';
export type NextStepKind = 'rerun' | 'review' | 'remediate' | 'expand' | 'report';
export type NextStepAction =
  | 'rerun'
  | 'summary'
  | 'review-trace'
  | 'review-approvals'
  | 'review-findings'
  | 'edit-scope'
  | null;

export interface SynthesisHighlight {
  kind: HighlightKind;
  text: string;
  refType?: string;
  refId?: string;
}

export interface SynthesisNextStep {
  kind: NextStepKind;
  text: string;
  action?: NextStepAction;
}

export interface RunSynthesis {
  v: 1;
  runId: string;
  title: string;
  status: string;
  goal: string | null;
  outcome: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  scope: { id: string; name: string; status: string; expiresAt: string | null } | null;
  objectives: { stated: string; met: ObjectiveMet; signal: string };
  activity: {
    events: number;
    toolCalls: { total: number; succeeded: number; failed: number; blocked: number };
    artifacts: number;
    errors: Array<{ tool?: string; preview?: string }>;
  };
  risk: {
    highest: string;
    distribution: { critical: number; high: number; medium: number; low: number };
    blockedHighRisk: number;
  };
  findings: {
    total: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
    new: number;
    resolved: number;
  };
  posture: {
    score: number;
    delta: number | null;
    components: { coverage: number; risk: number; hygiene: number };
    rating: SynthesisRating;
  };
  highlights: SynthesisHighlight[];
  nextSteps: SynthesisNextStep[];
  policy: {
    mode: string;
    approvals: {
      granted: number;
      denied: number;
      allowOnce: number;
      override: number;
      timeout: number;
    };
  };
  // Present only when the LLM enrichment ran successfully.
  enrichment?: { source: 'llm'; generatedAt: string };
}

export async function fetchRunSynthesis(id: string): Promise<RunSynthesis> {
  const data = await apiFetch<RunSynthesis>(
    `/api/runs/${encodeURIComponent(id)}/synthesis`,
  );
  if (!data) throw new Error('synthesis unavailable');
  return data;
}

export function useRunSynthesis(id: string | null | undefined) {
  return useQuery({
    queryKey: ['runs', 'synthesis', id],
    queryFn: () => fetchRunSynthesis(id!),
    enabled: Boolean(id),
  });
}
