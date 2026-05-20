// Run status pill. Tiny Badge wrapper that picks the right variant per
// RunStatus so the list rows + detail header render with consistent
// chip styling. Mirrors the CampaignPill / ScopePill pattern.
import { Badge } from './ui/badge';
import type { CampaignStatus, RunStatus } from '@/lib/types';

interface RunPillProps {
  status: RunStatus | string;
  className?: string;
}

// Map run status → existing badge variant so we don't have to extend
// badge.tsx for a new color set. The mapping mirrors the legacy CSS
// `.run-list-item .run-status.<status>` color tokens.
const VARIANT_BY_STATUS: Record<RunStatus, CampaignStatus> = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  // The legacy CSS treats `stopped` like a soft-cancel (gray-on-bg-3);
  // the canceled badge variant is the closest visual match.
  stopped: 'canceled',
  unknown: 'draft',
};

export function RunPill({ status, className }: RunPillProps) {
  const variant = (VARIANT_BY_STATUS[status as RunStatus] ?? 'draft') as CampaignStatus;
  return (
    <Badge variant={variant} className={className}>
      {status}
    </Badge>
  );
}
