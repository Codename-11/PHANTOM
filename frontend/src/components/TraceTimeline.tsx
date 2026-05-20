// Trace timeline — vertically stacked rows, one per event, with a
// severity-colored dot, the event seq + type + phase, and the
// outputPreview snippet. Replaces the legacy `.trace-event` rendering
// from frontend/js/pages/runs-page.js renderTraceTimeline().
//
// Kept deliberately simple — the legacy page does extra work (chunk
// aggregation, replay scrubbing) that the React detail Sheet does not
// own yet. The mega-plan defers the full replay scrubber to A8.5.

import type { TraceEvent } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TraceTimelineProps {
  events: TraceEvent[];
  className?: string;
}

// Map raw event status / type onto a small set of severity buckets so
// the dot color reflects "did this go well?" at a glance.
type Severity = 'info' | 'success' | 'warn' | 'error';

const DOT_COLOR: Record<Severity, string> = {
  info: 'bg-[var(--cy-2)]',
  success: 'bg-[#66c293]',
  warn: 'bg-[#d8b15a]',
  error: 'bg-destructive',
};

function severityFor(event: TraceEvent): Severity {
  if (event.type === 'tool.call.blocked' || event.type === 'scope.blocked') return 'warn';
  if (event.status === 'failed' || event.type === 'run.failed' || event.type === 'tool.call.failed') {
    return 'error';
  }
  if (event.status === 'completed') return 'success';
  return 'info';
}

function previewOf(event: TraceEvent): string {
  // tool_name renders separately in the row header, so we deliberately
  // do NOT fall back to it for the preview snippet — the legacy code
  // did, which produced duplicate "http.get http.get" rows when an
  // event had no output.
  return event.output_preview || event.outputPreview || '';
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
    <ol
      className={cn('relative space-y-2 list-none m-0 p-0', className)}
      data-testid="trace-timeline"
    >
      {events.map((event) => {
        const sev = severityFor(event);
        const preview = previewOf(event);
        return (
          <li
            key={event.id || `${event.run_id}-${event.seq}`}
            className="rounded-md border border-border bg-card px-3 py-2"
            data-event-type={event.type}
            data-event-status={event.status || ''}
            data-event-severity={sev}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('inline-block w-2 h-2 rounded-full shrink-0', DOT_COLOR[sev])}
              />
              <span className="font-mono text-[11px] text-muted-foreground">#{event.seq}</span>
              <strong className="text-[13px] text-foreground">{event.type}</strong>
              {event.tool_name ? (
                <em className="font-mono text-[11px] text-[var(--cy-2)] not-italic">
                  {event.tool_name}
                </em>
              ) : null}
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                {event.phase || '—'} · {event.status || '—'}
              </span>
            </div>
            {preview ? (
              <pre className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--fg-2)]">
                {preview}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default TraceTimeline;
