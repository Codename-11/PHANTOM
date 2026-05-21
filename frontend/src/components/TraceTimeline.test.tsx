// Trace timeline — renders the run's events using the kit's `.timeline` /
// `.evt` grammar and maps event status / type onto the kit's event state
// (tool / blocked / failed / ok / default) used by the colored node.
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

  it('renders one .evt node per event with the kind + tool name labels', () => {
    const events: TraceEvent[] = [
      ev({ seq: 1, type: 'run.started', status: 'started', phase: 'init' }),
      ev({ seq: 2, type: 'tool.call.completed', tool_name: 'http.get', status: 'completed' }),
      ev({ seq: 3, type: 'tool.call.blocked', tool_name: 'shell.exec', status: 'blocked', phase: 'tool' }),
      ev({ seq: 4, type: 'run.failed', status: 'failed', phase: 'end' }),
    ];
    const { container } = render(<TraceTimeline events={events} />);
    const rows = screen.getByTestId('trace-timeline').querySelectorAll('.evt');
    expect(rows.length).toBe(4);
    // Event type renders in the `.kind` slot.
    const kinds = Array.from(container.querySelectorAll('.evt .hdr .kind')).map(
      (n) => n.textContent,
    );
    expect(kinds).toContain('run.started');
    expect(kinds).toContain('tool.call.completed');
    // Tool name renders in the `.name` slot.
    const names = Array.from(container.querySelectorAll('.evt .hdr .name')).map(
      (n) => n.textContent,
    );
    expect(names).toContain('http.get');
    expect(names).toContain('shell.exec');
  });

  it('maps status / type onto the kit event state used by the node color', () => {
    const events: TraceEvent[] = [
      ev({ seq: 1, type: 'run.started', status: 'started' }),
      ev({ seq: 2, type: 'tool.call.completed', tool_name: 'http.get', status: 'completed' }),
      ev({ seq: 3, type: 'tool.call.blocked', tool_name: 'shell.exec', status: 'blocked' }),
      ev({ seq: 4, type: 'tool.call.failed', tool_name: 'http.get', status: 'failed' }),
      ev({ seq: 5, type: 'assistant.reply', status: 'completed' }),
    ];
    render(<TraceTimeline events={events} />);
    const rows = screen.getByTestId('trace-timeline').querySelectorAll('.evt');
    expect(rows[0]?.getAttribute('data-event-state')).toBe('info');
    expect(rows[1]?.getAttribute('data-event-state')).toBe('tool');
    expect(rows[2]?.getAttribute('data-event-state')).toBe('blocked');
    expect(rows[3]?.getAttribute('data-event-state')).toBe('failed');
    expect(rows[4]?.getAttribute('data-event-state')).toBe('ok');
    // The kit class is applied for non-default states.
    expect(rows[1]?.classList.contains('tool')).toBe(true);
    expect(rows[2]?.classList.contains('blocked')).toBe(true);
    expect(rows[3]?.classList.contains('failed')).toBe(true);
    expect(rows[4]?.classList.contains('ok')).toBe(true);
  });

  it('renders the outputPreview snippet in the body when present', () => {
    const events: TraceEvent[] = [
      ev({ seq: 1, type: 'assistant.reply', output_preview: 'hello world' }),
    ];
    render(<TraceTimeline events={events} />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders a .cmd block for tool events and a .reason line for blocked events', () => {
    const events: TraceEvent[] = [
      ev({
        seq: 1,
        type: 'tool.call.blocked',
        tool_name: 'shell.exec',
        status: 'blocked',
        metadata: { reason: 'destructive action not allowed' },
      }),
    ];
    const { container } = render(<TraceTimeline events={events} />);
    const cmd = container.querySelector('.evt.blocked .body .cmd');
    expect(cmd?.textContent).toBe('shell.exec');
    const reason = container.querySelector('.evt.blocked .reason');
    expect(reason?.textContent).toContain('destructive action not allowed');
  });
});
