// Scope status pill. Mirrors the CampaignPill pattern — a tiny Badge
// wrapper that picks the right variant per derived ScopeStatus so the
// list rows and detail sheet render with the same chip styling.
import { Badge } from './ui/badge';
import type { ScopeStatus } from '@/lib/types';

interface ScopePillProps {
  status: ScopeStatus;
  className?: string;
}

// Map our 3 derived states onto the existing badge variants so we don't
// have to introduce new ones (and avoid touching badge.tsx in this phase).
const VARIANT_BY_STATUS: Record<
  ScopeStatus,
  'completed' | 'failed' | 'canceled'
> = {
  active: 'completed',
  expired: 'failed',
  archived: 'canceled',
};

const LABEL_BY_STATUS: Record<ScopeStatus, string> = {
  active: 'active',
  expired: 'expired',
  archived: 'archived',
};

export function ScopePill({ status, className }: ScopePillProps) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status]} className={className}>
      {LABEL_BY_STATUS[status]}
    </Badge>
  );
}
