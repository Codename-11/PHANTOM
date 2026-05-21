// Run status pill. Tiny Badge wrapper that picks the right variant per
// RunStatus so the list rows + detail header render with consistent
// chip styling. Mirrors the CampaignPill / ScopePill pattern.
//
// A live run states map onto the ported agent-state animations so the
// pill carries motion, not just color:
//   running   → ScanningIcon (active recon sweep — the agent is working)
//   completed → VerifiedIcon (green check draw, plays once)
// Other statuses stay text-only. The status label text is always
// preserved so screen readers + tests still read the word.
import { Badge } from './ui/badge';
import { ScanningIcon, VerifiedIcon } from './AgentStateIcon';
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

// Inline agent-state icon for the in-flight / resolved statuses. Sized to
// sit flush with the pill's text cap-height.
function StatusIcon({ status }: { status: string }) {
  if (status === 'running') {
    return <ScanningIcon size={14} className="-ml-0.5 shrink-0" />;
  }
  if (status === 'completed') {
    return <VerifiedIcon size={14} className="-ml-0.5 shrink-0" play />;
  }
  return null;
}

export function RunPill({ status, className }: RunPillProps) {
  const variant = (VARIANT_BY_STATUS[status as RunStatus] ?? 'draft') as CampaignStatus;
  return (
    <Badge variant={variant} className={className}>
      <span className="inline-flex items-center gap-1">
        <StatusIcon status={status} />
        {status}
      </span>
    </Badge>
  );
}
