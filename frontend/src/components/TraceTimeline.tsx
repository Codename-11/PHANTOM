// Trace timeline — renders the run's events with the PHANTOM SEC kit's
// `.timeline` / `.evt` grammar (a single vertical rail with colored event
// nodes). Replaces the legacy `.trace-event` rendering from
// frontend/js/pages/runs-page.js renderTraceTimeline().
//
// State → kit class mapping (frontend/src/styles/kit-components.css):
//   tool    → `.evt.tool`     filled cyan node       (tool.call.* events)
//   blocked → `.evt.blocked`  purple node + reason   (policy-blocked)
//   failed  → `.evt.failed`   red node               (failed / errored)
//   ok      → `.evt.ok`       green node             (completed)
//   default → `.evt`          cyan-border node       (everything else)
//
// Data wiring is unchanged: events still arrive from useRunEvents and we
// only read the existing TraceEvent fields.

import type { TraceEvent } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TraceTimelineProps {
  events: TraceEvent[];
  className?: string;
}

// The kit's four event states (plus the implicit cyan-border default).
type EvtState = 'tool' | 'blocked' | 'failed' | 'ok' | 'info';

function isBlocked(event: TraceEvent): boolean {
  return (
    event.type === 'tool.call.blocked' ||
    event.type === 'scope.blocked' ||
    event.status === 'blocked'
  );
}

function isFailed(event: TraceEvent): boolean {
  return (
    event.status === 'failed' ||
    event.type === 'run.failed' ||
    event.type === 'tool.call.failed'
  );
}

// Map a raw event onto one of the kit's `.evt` states. Order matters:
// governance (blocked) and failure outrank the generic "tool" styling.
function stateFor(event: TraceEvent): EvtState {
  if (isBlocked(event)) return 'blocked';
  if (isFailed(event)) return 'failed';
  if (event.type.startsWith('tool.call')) return 'tool';
  if (event.status === 'completed') return 'ok';
  return 'info';
}

function previewOf(event: TraceEvent): string {
  // tool_name renders in the header, so we deliberately do NOT fall back
  // to it for the body snippet — that produced duplicate rows in legacy.
  return event.output_preview || event.outputPreview || '';
}

// The mono command line surfaced in a `.cmd` block. We use the tool name
// (the action) so blocked / tool events show what was attempted.
function commandOf(event: TraceEvent): string {
  return event.tool_name ?? '';
}

// Policy reason for blocked events — pulled from metadata if the server
// attached one, otherwise a sensible default.
function reasonOf(event: TraceEvent): string | null {
  if (!isBlocked(event)) return null;
  const meta = event.metadata;
  if (meta && typeof meta === 'object') {
    const r = (meta as Record<string, unknown>).reason;
    if (typeof r === 'string' && r.trim()) return r;
  }
  return 'blocked by scope policy';
}

// Right-aligned timestamp — prefer the wall-clock created_at.
function tsOf(event: TraceEvent): string {
  return event.created_at || event.started_at || '';
}

export function TraceTimeline({ events, className }: TraceTimelineProps) {
  if (!events.length) {
    return (
      <div
        className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-4 text-sm text-muted-foreground"
        data-testid="trace-timeline-empty"
      >
        No trace events recorded.
      </div>
    );
  }

  return (
    <div className={cn('timeline', className)} data-testid="trace-timeline">
      {events.map((event) => {
        const state = stateFor(event);
        const preview = previewOf(event);
        const cmd = commandOf(event);
        const reason = reasonOf(event);
        const ts = tsOf(event);
        return (
          <div
            key={event.id || `${event.run_id}-${event.seq}`}
            className={cn('evt', state !== 'info' && state)}
            data-event-type={event.type}
            data-event-status={event.status || ''}
            data-event-state={state}
          >
            <div className="hdr">
              <span className="kind">{event.type}</span>
              {event.tool_name ? (
                <span className="name">{event.tool_name}</span>
              ) : null}
              {ts ? <span className="ts">{ts}</span> : null}
            </div>
            {preview || cmd || reason ? (
              <div className="body">
                {preview ? <span>{preview}</span> : null}
                {cmd ? <span className="cmd">{cmd}</span> : null}
                {reason ? <span className="reason">⤷ {reason}</span> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default TraceTimeline;
