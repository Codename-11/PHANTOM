// Tiny Badge wrapper that picks the right campaign-pill variant for the
// supplied status. Used by the list rows, drawer header, goals timeline,
// and runs timeline so the chip styling stays in one place.
import { Badge } from './ui/badge';
import type { CampaignStatus, GoalStatus, RunStatus } from '@/lib/types';

interface CampaignPillProps {
  status: string;
  className?: string;
}

const KNOWN_STATUSES = new Set<CampaignStatus>([
  'draft',
  'queued',
  'running',
  'paused',
  'needs_approval',
  'completed',
  'failed',
  'canceled',
]);

export function CampaignPill({ status, className }: CampaignPillProps) {
  // The Badge variant is constrained to CampaignStatus; anything else
  // falls back to the neutral 'draft' look.
  const variant = KNOWN_STATUSES.has(status as CampaignStatus)
    ? (status as CampaignStatus)
    : 'draft';
  return (
    <Badge variant={variant} className={className}>
      {status}
    </Badge>
  );
}

// Map goal/run status → campaign-pill variant. Mirrors mapGoalStatus +
// mapRunStatus from the legacy campaign-presenter.js so the timeline +
// child-run rows render with the same chip colors as today.
export function mapGoalStatus(s: GoalStatus | string): CampaignStatus {
  if (s === 'completed') return 'completed';
  if (s === 'failed' || s === 'skipped') return 'failed';
  if (s === 'running') return 'running';
  if (s === 'needs_approval') return 'needs_approval';
  if (s === 'blocked') return 'paused';
  return 'draft';
}

export function mapRunStatus(s: RunStatus | string): CampaignStatus {
  if (s === 'completed') return 'completed';
  if (s === 'failed' || s === 'stopped') return 'failed';
  if (s === 'running') return 'running';
  return 'draft';
}
