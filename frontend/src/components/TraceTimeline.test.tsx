// Trace timeline — renders one row per event and maps event status /
// type onto a severity bucket so the dot color follows the convention
// from the legacy `.trace-event` CSS.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TraceTimeline } from './TraceTimeline';
import type { TraceEvent } from '@/lib/types';

function ev(over: Partial<TraceEvent>): TraceEvent {
  return {
    id: over.id ?? `e-${over.seq}`,
    run_id: 'run-1',
    parent_event_id: null,
    seq: over.seq ?? 1,
    type: over.type ?? 'tool.call.completed',
    phase: over.phase ?? 'tool',
    status: over.status ?? 'completed',
    tool_name: over.tool_name ?? null,
    input: over.input,
    output_ref: over.output_ref ?? null,
    output_preview: over.output_preview ?? null,
    metadata: over.metadata ?? null,
    started_at: over.started_at ?? null,
    ended_at: over.ended_at ?? null,
    duration_ms: over.duration_ms ?? null,
    created_at: over.created_at ?? '2026-05-20T12:00:00Z',
  };
}

describe('TraceTimeline', () => {
  it('renders the empty state when no events are supplied', () => {
    render(<TraceTimeline events={[]} />);
    expect(screen.getByTestId('trace-timeline-empty')).toBeInTheDocument();
  });

  it('renders one row per event with the correct labels', () => {
    const events: TraceEvent[] = [
      ev({ seq: 1, type: 'run.started', status: 'started', phase: 'init' }),
      ev({ seq: 2, type: 'tool.call.completed', tool_name: 'http.get', status: 'completed' }),
      ev({ seq: 3, type: 'tool.call.blocked', tool_name: 'shell.exec', status: 'blocked', phase: 'tool' }),
      ev({ seq: 4, type: 'run.failed', status: 'failed', phase: 'end' }),
    ];
    render(<TraceTimeline events={events} />);
    const rows = screen.getByTestId('trace-timeline').querySelectorAll('li');
    expect(rows.length).toBe(4);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('http.get')).toBeInTheDocument();
    expect(screen.getByText('shell.exec')).toBeInTheDocument();
  });

  it('maps status / type onto the severity attribute used by the dot', () => {
    const events: TraceEvent[] = [
      ev({ seq: 1, type: 'run.started', status: 'started' }),
      ev({ seq: 2, type: 'tool.call.completed', status: 'completed' }),
      ev({ seq: 3, type: 'tool.call.blocked', status: 'blocked' }),
      ev({ seq: 4, type: 'tool.call.failed', status: 'failed' }),
    ];
    render(<TraceTimeline events={events} />);
    const rows = screen.getByTestId('trace-timeline').querySelectorAll('li');
    expect(rows[0]?.getAttribute('data-event-severity')).toBe('info');
    expect(rows[1]?.getAttribute('data-event-severity')).toBe('success');
    expect(rows[2]?.getAttribute('data-event-severity')).toBe('warn');
    expect(rows[3]?.getAttribute('data-event-severity')).toBe('error');
  });

  it('renders the outputPreview snippet when present', () => {
    const events: TraceEvent[] = [
      ev({ seq: 1, type: 'assistant.reply', output_preview: 'hello world' }),
    ];
    render(<TraceTimeline events={events} />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });
});
