// TriageRail tests — the 4-button rail submits the right triageStatus
// for low/medium findings, and opens the dismissal-note Dialog when the
// user tries to dismiss a high|crit finding without a note.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { TriageRail } from './TriageRail';
import type { FindingRecord } from '@/lib/types';

function makeFinding(severity: string): FindingRecord {
  return {
    id: 'f-1',
    title: 'Test finding',
    description: null,
    severity,
    status: 'open',
    assetId: null,
    runId: null,
    recommendation: null,
    evidence: null,
    metadata: null,
    first_seen_at: null,
    last_seen_at: null,
    fixed_at: null,
    triage_status: 'new',
  };
}

describe('TriageRail', () => {
  it('renders the four action buttons', () => {
    render(<TriageRail finding={makeFinding('low')} onTriage={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Ack/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /In progress/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dismiss/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close/ })).toBeInTheDocument();
  });

  it('submits a low-severity dismissal directly (no note dialog)', async () => {
    const onTriage = vi.fn().mockResolvedValue(undefined);
    render(<TriageRail finding={makeFinding('low')} onTriage={onTriage} />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    await waitFor(() => {
      expect(onTriage).toHaveBeenCalledWith('dismissed', null);
    });
    expect(screen.queryByTestId('dismiss-note-dialog')).not.toBeInTheDocument();
  });

  it('opens the dismissal-note Dialog when dismissing a high finding', async () => {
    const onTriage = vi.fn().mockResolvedValue(undefined);
    render(<TriageRail finding={makeFinding('high')} onTriage={onTriage} />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    await waitFor(() => {
      expect(screen.getByTestId('dismiss-note-dialog')).toBeInTheDocument();
    });
    // Without a note, the confirm button is disabled.
    expect(screen.getByTestId('dismiss-confirm-btn')).toBeDisabled();
    expect(onTriage).not.toHaveBeenCalled();
  });

  it('opens the dismissal-note Dialog when dismissing a critical finding', async () => {
    render(<TriageRail finding={makeFinding('critical')} onTriage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    await waitFor(() => {
      expect(screen.getByTestId('dismiss-note-dialog')).toBeInTheDocument();
    });
  });

  it('submits dismissal with note once the operator fills in the textarea', async () => {
    const onTriage = vi.fn().mockResolvedValue(undefined);
    render(<TriageRail finding={makeFinding('high')} onTriage={onTriage} />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    await waitFor(() => {
      expect(screen.getByTestId('dismiss-note-dialog')).toBeInTheDocument();
    });
    const note = screen.getByTestId('dismiss-note-input') as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: 'False positive — manually verified.' } });
    fireEvent.click(screen.getByTestId('dismiss-confirm-btn'));
    await waitFor(() => {
      expect(onTriage).toHaveBeenCalledWith('dismissed', 'False positive — manually verified.');
    });
  });

  it('Ack button submits acknowledged status', async () => {
    const onTriage = vi.fn().mockResolvedValue(undefined);
    render(<TriageRail finding={makeFinding('high')} onTriage={onTriage} />);
    fireEvent.click(screen.getByRole('button', { name: /Ack/ }));
    await waitFor(() => {
      expect(onTriage).toHaveBeenCalledWith('acknowledged', null);
    });
  });
});
