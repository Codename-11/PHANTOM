// Replay scrubber — a chronological timeline/slider over a run's trace
// events, ported from the legacy frontend/js/pages/runs-page.js replay
// controls (setupReplay / replayToggle / replayStep / replayReset /
// updateReplayUI). Page-scoped to Runs (A8.5b parity-close).
//
// Behavior parity with legacy:
//   - Play steps one event every 600ms; honours prefers-reduced-motion
//     (no auto-advance — Play falls back to a single Step).
//   - Step / Reset / a range <input> let the operator scrub manually.
//   - A blocked-action marker sits on the track at its position.
//   - The current event is highlighted in an inline event list, with the
//     timestamp + event id surfaced via Tooltip.
//
// Position is rendered with the ui/Progress primitive. Events come from
// useRunEvents (passed in by the caller) — no new endpoint is invented.
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { TraceEvent } from '@/lib/types';

const STEP_INTERVAL_MS = 600;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function isBlocked(event: TraceEvent): boolean {
  return (
    event.type === 'tool.call.blocked' ||
    event.type === 'scope.blocked' ||
    event.status === 'blocked'
  );
}

function severityClass(event: TraceEvent): string {
  // Blocked = governance → purple (--policy), matching the trace timeline's
  // `.evt.blocked` node, not a warm severity color.
  if (isBlocked(event)) return 'bg-[var(--policy)]';
  if (event.status === 'failed' || event.type === 'tool.call.failed' || event.type === 'run.failed') {
    return 'bg-destructive';
  }
  if (event.status === 'completed') return 'bg-[var(--ok-2)]';
  return 'bg-[var(--cy-2)]';
}

export interface RunReplayScrubberProps {
  events: TraceEvent[];
}

export function RunReplayScrubber({ events }: RunReplayScrubberProps) {
  const total = events.length;
  // index is 1-based "events shown so far" (0 = nothing yet, total = all).
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  const blockedIndex = useMemo(() => events.findIndex(isBlocked), [events]);

  // Reset whenever the run's events change (operator opened another run).
  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [events]);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (!playing) {
      stopTimer();
      return;
    }
    timerRef.current = setInterval(() => {
      setIndex((prev) => {
        const next = prev + 1;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
    }, STEP_INTERVAL_MS);
    return stopTimer;
  }, [playing, total]);

  useEffect(() => stopTimer, []);

  // Scroll the current event into view as it changes.
  useEffect(() => {
    const el = rowRefs.current[index - 1];
    if (el && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch {
        /* jsdom / no-op */
      }
    }
  }, [index]);

  if (!total) {
    return (
      <div
        className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-4 text-sm text-muted-foreground"
        data-testid="replay-scrubber-empty"
      >
        No trace events to replay.
      </div>
    );
  }

  const onTogglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (prefersReducedMotion()) {
      // No auto-advance under reduced motion — Play acts as a single Step.
      setIndex((prev) => Math.min(prev + 1, total));
      return;
    }
    setIndex((prev) => (prev >= total ? 0 : prev));
    setPlaying(true);
  };

  const onStep = () => {
    setPlaying(false);
    setIndex((prev) => Math.min(prev + 1, total));
  };

  const onReset = () => {
    setPlaying(false);
    setIndex(0);
  };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlaying(false);
    setIndex(Number(e.target.value));
  };

  const currentEvent = index > 0 ? events[index - 1] : null;
  const blockedPct =
    blockedIndex >= 0 ? (blockedIndex / Math.max(total - 1, 1)) * 100 : null;

  return (
    <div className="space-y-3 py-1" data-testid="replay-scrubber">
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onTogglePlay}
          data-replay-action="play"
          aria-label={playing ? 'Pause replay' : 'Play replay'}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onStep}
          disabled={index >= total}
          data-replay-action="step"
        >
          Step ›
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset} data-replay-action="reset">
          ↻ Reset
        </Button>
        <span
          className="ml-auto font-mono text-[11px] text-muted-foreground"
          data-testid="replay-counter"
        >
          {String(Math.min(index, total)).padStart(2, '0')} /{' '}
          {String(total).padStart(2, '0')}
        </span>
      </div>

      <div className="relative">
        <Progress value={index} max={total} label="Replay position" />
        {blockedPct != null ? (
          <Tooltip content="Blocked action">
            <span
              aria-hidden="true"
              data-testid="replay-blocked-mark"
              className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-[var(--policy)]"
              style={{ left: `${blockedPct}%` }}
            />
          </Tooltip>
        ) : null}
        {/* Accessible scrub control overlaid on the track. */}
        <input
          type="range"
          min={0}
          max={total}
          value={index}
          onChange={onScrub}
          aria-label="Scrub replay position"
          data-testid="replay-range"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground" data-testid="replay-current">
        {currentEvent ? (
          <>
            <span className="font-mono">#{currentEvent.seq}</span>
            <strong className="text-foreground">{currentEvent.type}</strong>
            {currentEvent.tool_name ? (
              <em className="font-mono not-italic text-[var(--cy-2)]">{currentEvent.tool_name}</em>
            ) : null}
            <Tooltip content={`event ${currentEvent.id}`}>
              <span className="ml-auto cursor-help font-mono">
                {currentEvent.created_at || '—'}
              </span>
            </Tooltip>
          </>
        ) : (
          <span>Press Play or Step to walk the run chronologically.</span>
        )}
      </div>

      <ol
        className="relative max-h-64 space-y-1.5 overflow-y-auto list-none m-0 p-0"
        data-testid="replay-event-list"
      >
        {events.map((event, i) => {
          const seen = i < index;
          const isCurrent = i === index - 1;
          return (
            <li
              key={event.id || `${event.run_id}-${event.seq}`}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              data-event-type={event.type}
              data-replay-current={isCurrent || undefined}
              className={cn(
                'rounded-md border px-3 py-1.5 transition-colors',
                isCurrent
                  ? 'border-[var(--cy-2)] bg-[var(--bg-3)]'
                  : 'border-border bg-card',
                !seen && 'opacity-45',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn('inline-block h-2 w-2 shrink-0 rounded-full', severityClass(event))}
                />
                <span className="font-mono text-[11px] text-muted-foreground">#{event.seq}</span>
                <strong className="text-[12px] text-foreground">{event.type}</strong>
                {event.tool_name ? (
                  <em className="font-mono text-[11px] not-italic text-[var(--cy-2)]">
                    {event.tool_name}
                  </em>
                ) : null}
                <Tooltip content={`event ${event.id} · ${event.created_at || 'no timestamp'}`}>
                  <span className="ml-auto cursor-help font-mono text-[10px] text-muted-foreground">
                    {event.created_at || '—'}
                  </span>
                </Tooltip>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default RunReplayScrubber;
