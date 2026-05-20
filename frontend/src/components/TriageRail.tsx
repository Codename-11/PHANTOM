// TriageRail — 4-button row for finding triage. Ack / In progress /
// Dismiss / Close. Dismissing a high|crit severity opens a Dialog that
// captures the required `dismissal_note` before submitting.
//
// Mirrors the legacy frontend/js/pages/alerts-page.js triage flow and
// the server contract at PATCH /api/findings/:id/triage (rejects high|
// crit dismissals without a note with HTTP 400 + dismissal_note_required).
import { useState } from 'react';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Textarea } from './ui/textarea';
import {
  severityRequiresNote,
} from '@/lib/findings';
import type { FindingRecord, FindingTriageStatus } from '@/lib/types';

interface TriageRailProps {
  finding: FindingRecord;
  onTriage: (
    triageStatus: FindingTriageStatus,
    dismissalNote: string | null,
  ) => void | Promise<void>;
  disabled?: boolean;
}

export function TriageRail({ finding, onTriage, disabled = false }: TriageRailProps) {
  const [dismissOpen, setDismissOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const needsNote = severityRequiresNote(finding.severity);

  async function handle(status: FindingTriageStatus) {
    if (status === 'dismissed' && needsNote) {
      setDismissOpen(true);
      return;
    }
    setSubmitting(true);
    try {
      await onTriage(status, null);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDismiss() {
    const trimmed = note.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onTriage('dismissed', trimmed);
      setDismissOpen(false);
      setNote('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Triage actions"
        data-testid="triage-rail"
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || submitting}
          onClick={() => handle('acknowledged')}
          data-triage-status="acknowledged"
        >
          Ack
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || submitting}
          onClick={() => handle('in_progress')}
          data-triage-status="in_progress"
        >
          In progress
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={disabled || submitting}
          onClick={() => handle('dismissed')}
          data-triage-status="dismissed"
        >
          Dismiss
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={disabled || submitting}
          onClick={() => handle('closed')}
          data-triage-status="closed"
        >
          Close
        </Button>
      </div>

      <Dialog open={dismissOpen} onOpenChange={(o) => { if (!o) { setDismissOpen(false); setNote(''); } }}>
        <DialogContent data-testid="dismiss-note-dialog">
          <DialogHeader>
            <DialogTitle>Dismissal note required</DialogTitle>
            <DialogDescription>
              You're dismissing a {finding.severity || 'severe'} finding. Please record
              the reason — this becomes the audit trail entry.
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this being dismissed? (required)"
              rows={4}
              data-testid="dismiss-note-input"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDismissOpen(false); setNote(''); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={submitDismiss}
              disabled={submitting || !note.trim()}
              data-testid="dismiss-confirm-btn"
            >
              {submitting ? 'Dismissing…' : 'Dismiss finding'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default TriageRail;
