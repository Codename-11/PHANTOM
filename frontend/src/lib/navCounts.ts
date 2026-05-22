// Read-only composition hook that feeds the sidebar's per-item count
// badges. It reuses the EXISTING React Query hooks (findings / runs /
// approvals / scope-assets) — no new endpoints — and derives the four
// counts the kit shell shows next to nav items:
//
//   alerts    → untriaged findings (triage_status new/null, not closed/fixed)
//   runs      → active runs (queued | running)
//   approvals → pending governance gate decisions
//   assets    → assets in scope (asset catalogue size)
//
// Every count degrades to `undefined` when the underlying query is still
// loading or errored, so the sidebar simply omits the badge (kit parity:
// no `.ct` element when `count == null`).
import { useApprovals } from './approvals';
import { useFindings } from './findings';
import { useRuns } from './runs';
import { useScopeAssets } from './scopes';

export interface NavCounts {
  alerts?: number;
  runs?: number;
  approvals?: number;
  assets?: number;
}

// Triage states that count as "needs operator attention". A finding is
// untriaged while it is brand new or has no triage row yet; once it has
// been acknowledged / dismissed / closed it drops off the badge.
const UNTRIAGED = new Set(['new']);

export function useNavCounts(): NavCounts {
  const findings = useFindings();
  const runs = useRuns();
  const approvals = useApprovals();
  const assets = useScopeAssets();

  const counts: NavCounts = {};

  if (findings.isSuccess && Array.isArray(findings.data)) {
    counts.alerts = findings.data.filter((f) => {
      const t = (f.triage_status ?? 'new') as string;
      const open = f.status !== 'fixed' && f.status !== 'closed';
      return open && UNTRIAGED.has(t);
    }).length;
  }

  if (runs.isSuccess && Array.isArray(runs.data)) {
    counts.runs = runs.data.filter(
      (r) => r.status === 'running' || r.status === 'queued',
    ).length;
  }

  if (approvals.isSuccess && approvals.data) {
    counts.approvals = approvals.data.pending.length;
  }

  if (assets.isSuccess && Array.isArray(assets.data)) {
    counts.assets = assets.data.length;
  }

  return counts;
}
