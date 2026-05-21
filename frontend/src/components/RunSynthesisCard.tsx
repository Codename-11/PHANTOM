// React port of the legacy frontend/js/synthesis-card.js renderer, scoped
// to the Runs page (A8.5b parity-close). Renders the canonical v1 synthesis
// shape from GET /api/runs/:id/synthesis: outcome headline, posture ring,
// objective / activity / posture cards, and the enriched highlights +
// next-steps. next-step actions surface as Tooltip-annotated rows.
//
// Page-scoped on purpose — not promoted to a shared primitive — so the
// parallel A8.5b agents don't collide. Uses only ui/* primitives.
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip } from '@/components/ui/tooltip';
import type {
  HighlightKind,
  NextStepKind,
  RunSynthesis,
  SynthesisHighlight,
  SynthesisNextStep,
} from '@/lib/runs-synthesis';

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function highlightIcon(kind: HighlightKind): string {
  if (kind === 'win') return '✓';
  if (kind === 'risk') return '⚠';
  return '·';
}

function nextStepIcon(kind: NextStepKind): string {
  if (kind === 'rerun') return '↻';
  if (kind === 'remediate') return '✚';
  if (kind === 'review') return '◎';
  if (kind === 'report') return '✎';
  if (kind === 'expand') return '⤢';
  return '→';
}

const RATING_COLOR: Record<string, string> = {
  strong: 'text-[var(--ok-2)]',
  fair: 'text-[var(--warn-2)]',
  weak: 'text-destructive',
  unknown: 'text-[var(--cy-1)]',
};

const HIGHLIGHT_COLOR: Record<HighlightKind, string> = {
  win: 'text-[var(--ok-2)]',
  risk: 'text-[var(--warn-2)]',
  note: 'text-muted-foreground',
};

function PostureRing({ score, rating }: { score: number; rating: string }) {
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  const circumference = 226.2;
  const dash = ((pct / 100) * circumference).toFixed(1);
  return (
    <div
      className={`relative inline-flex items-center justify-center ${RATING_COLOR[rating] ?? RATING_COLOR.unknown}`}
      aria-label={`Posture ${pct} of 100, ${rating}`}
      data-testid="synthesis-posture-ring"
    >
      <svg viewBox="0 0 80 80" width="72" height="72" aria-hidden="true">
        <circle cx="40" cy="40" r="36" fill="none" stroke="var(--line-2)" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r="36"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <strong className="text-lg font-mono">{pct}</strong>
        <span className="font-mono text-[9px] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

function DeltaPill({ delta }: { delta: number | null }) {
  if (delta == null || !Number.isFinite(delta)) return null;
  if (delta === 0) {
    return <span className="font-mono text-[11px] text-muted-foreground">±0</span>;
  }
  const up = delta > 0;
  return (
    <span className={`font-mono text-[11px] ${up ? 'text-[var(--ok-2)]' : 'text-destructive'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  );
}

function ComponentRow({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      <Progress value={pct} className="flex-1" />
      <span className="w-7 text-right font-mono text-[11px] text-[var(--fg-2)]">{pct}</span>
    </div>
  );
}

interface RunSynthesisCardProps {
  synthesis: RunSynthesis;
  onAction?: (action: NonNullable<SynthesisNextStep['action']>) => void;
}

export function RunSynthesisCard({ synthesis, onAction }: RunSynthesisCardProps) {
  const a = synthesis.activity;
  const t = a.toolCalls;
  const c = synthesis.posture.components;
  const approvals = Object.entries(synthesis.policy?.approvals ?? {}).filter(
    ([, v]) => (v as number) > 0,
  );

  return (
    <article className="space-y-4 py-1" data-testid="synthesis-card">
      <header className="flex items-start gap-4 rounded-md border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            End-of-run synthesis
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-foreground break-words">
            {synthesis.title || 'Run'}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground break-words" data-testid="synthesis-outcome">
            {synthesis.outcome}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="font-mono">
              {synthesis.status}
            </Badge>
            {synthesis.scope ? (
              <Badge variant="outline" className="font-mono">
                {synthesis.scope.name}
              </Badge>
            ) : null}
            <Badge variant="outline" className="font-mono">
              {formatDuration(synthesis.durationMs)}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {synthesis.policy?.mode || 'governed'}
            </Badge>
            {synthesis.enrichment ? (
              <Tooltip content={`LLM-enriched ${synthesis.enrichment.generatedAt}`}>
                <Badge className="border-[var(--cy-2)] bg-transparent font-mono text-[var(--cy-2)]">
                  AI
                </Badge>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <PostureRing score={synthesis.posture.score} rating={synthesis.posture.rating} />
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              {synthesis.posture.rating}
            </span>
            <DeltaPill delta={synthesis.posture.delta} />
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-1.5 pt-4">
            <h4 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Objective
            </h4>
            <p className="text-[13px] text-foreground break-words">
              {synthesis.objectives.stated || synthesis.goal || 'No goal recorded.'}
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono uppercase">
                {synthesis.objectives.met}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {synthesis.objectives.signal}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1.5 pt-4">
            <h4 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Activity
            </h4>
            <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 text-[12px]">
              <dt className="text-muted-foreground">events</dt>
              <dd className="font-mono text-[var(--fg-2)]">{a.events}</dd>
              <dt className="text-muted-foreground">tool calls</dt>
              <dd className="font-mono text-[var(--fg-2)]">
                {t.total}{' '}
                <span className="text-[10px] text-muted-foreground">
                  ({t.succeeded} ok · {t.failed} failed · {t.blocked} blocked)
                </span>
              </dd>
              <dt className="text-muted-foreground">artifacts</dt>
              <dd className="font-mono text-[var(--fg-2)]">{a.artifacts}</dd>
              <dt className="text-muted-foreground">approvals</dt>
              <dd className="flex flex-wrap gap-1">
                {approvals.length ? (
                  approvals.map(([k, v]) => (
                    <span key={k} className="font-mono text-[11px] text-[var(--fg-2)]">
                      <b>{v as number}</b> {k}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-muted-foreground">none</span>
                )}
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h4 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Posture breakdown
          </h4>
          <ComponentRow label="Coverage" value={c.coverage} />
          <ComponentRow label="Risk" value={c.risk} />
          <ComponentRow label="Hygiene" value={c.hygiene} />
          <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
            <span className="font-mono uppercase tracking-[0.06em]">Findings</span>
            <span className="font-mono text-[var(--fg-2)]">
              {synthesis.findings.total} total · {synthesis.findings.new} new ·{' '}
              {synthesis.findings.resolved} resolved
            </span>
          </div>
        </CardContent>
      </Card>

      {synthesis.highlights.length ? (
        <Card>
          <CardContent className="space-y-1.5 pt-4">
            <h4 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Highlights
            </h4>
            <ul className="space-y-1 list-none m-0 p-0" data-testid="synthesis-highlights">
              {synthesis.highlights.map((h: SynthesisHighlight, i: number) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <span aria-hidden="true" className={`shrink-0 ${HIGHLIGHT_COLOR[h.kind]}`}>
                    {highlightIcon(h.kind)}
                  </span>
                  <span className="text-foreground break-words">{h.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {synthesis.nextSteps.length ? (
        <Card>
          <CardContent className="space-y-1.5 pt-4">
            <h4 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Next steps
            </h4>
            <ul className="space-y-1.5 list-none m-0 p-0" data-testid="synthesis-next-steps">
              {synthesis.nextSteps.map((s: SynthesisNextStep, i: number) => {
                const row = (
                  <span className="flex items-start gap-2 text-[13px]">
                    <span aria-hidden="true" className="shrink-0 text-[var(--cy-2)]">
                      {nextStepIcon(s.kind)}
                    </span>
                    <span className="text-foreground break-words">{s.text}</span>
                  </span>
                );
                if (s.action && onAction) {
                  const action = s.action;
                  return (
                    <li key={i}>
                      <Tooltip content={`Action: ${action}`}>
                        <button
                          type="button"
                          onClick={() => onAction(action)}
                          data-synth-action={action}
                          className="block w-full rounded-md border border-transparent px-2 py-1 text-left transition-colors hover:border-[var(--line-2)] hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row}
                        </button>
                      </Tooltip>
                    </li>
                  );
                }
                return (
                  <li key={i} className="px-2 py-1" role="note">
                    {row}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </article>
  );
}

export default RunSynthesisCard;
