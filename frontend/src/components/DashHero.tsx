// DashHero — pure renderer of the next-action hero card for /react/dash.
//
// Mirrors the legacy frontend/js/pages/dash-hero.js visual: an article
// with `dash-hero` class, tone-tinted left-border accent (crit / cy /
// warn / ok), a primary CTA button, and an optional "Continue where you
// left off" pill anchored at the bottom.
//
// Stateless on purpose — the cascade lives in lib/dash.ts so the same
// `DashHeroAction` shape can be derived in tests without rendering.
import { Link } from 'react-router-dom';

import { Button } from './ui/button';
import type { ContinueWhereLeftOff, DashHeroAction } from '@/lib/types';

interface DashHeroProps {
  action: DashHeroAction;
  continueCard?: ContinueWhereLeftOff | null;
}

const TONE_ACCENT: Record<DashHeroAction['tone'], string> = {
  crit: 'border-l-destructive',
  warn: 'border-l-[var(--warn-2)]',
  cy:   'border-l-[var(--cy-1)]',
  ok:   'border-l-[var(--ok-2)]',
};

function routeToPath(route: string | undefined): string {
  if (!route) return '/dash';
  // Router routes (`approvals`, `settings`, `campaigns`, `scope`, `runs`,
  // …) map directly to the bare canonical path. Unknown values fall back
  // to Dash.
  return `/${route}`;
}

export function DashHero({ action, continueCard }: DashHeroProps) {
  const accent = TONE_ACCENT[action.tone] ?? 'border-l-[var(--cy-1)]';
  const ctaPath = routeToPath(action.ctaRoute);
  const ctaIsAnchor = Boolean(action.ctaScroll && !action.ctaRoute);

  return (
    <article
      data-tone={action.tone}
      data-testid="dash-hero"
      className={`rounded-lg border border-border bg-card text-card-foreground px-4 py-3 border-l-2 ${accent} shadow-sm`}
    >
      <div className="flex flex-col gap-2">
        <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground">
          {action.eyebrow}
        </p>
        <h2 className="text-lg font-semibold text-foreground leading-tight">
          {action.title}
        </h2>
        {action.body ? (
          <p className="text-sm text-[var(--fg-2)] max-w-3xl">{action.body}</p>
        ) : null}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {ctaIsAnchor ? (
            <Button
              variant="primary"
              size="sm"
              data-hero-action="primary"
              data-hero-scroll={action.ctaScroll}
              onClick={() => {
                if (typeof document !== 'undefined' && action.ctaScroll) {
                  const target = document.getElementById(action.ctaScroll);
                  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
            >
              {action.ctaLabel}
            </Button>
          ) : (
            <Button variant="primary" size="sm" asChild data-hero-action="primary">
              <Link to={ctaPath} data-hero-route={action.ctaRoute ?? ''}>
                {action.ctaLabel}
              </Link>
            </Button>
          )}
          {continueCard ? (
            <span
              className="inline-flex items-center gap-2 text-xs text-muted-foreground"
              data-testid="continue-pill"
            >
              <span className="font-mono uppercase tracking-[0.06em] text-[10px]">
                Continue where you left off:
              </span>
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to={continueCard.route ? routeToPath(continueCard.route) : '/dash'}
                  data-continue-id={continueCard.id}
                >
                  {continueCard.label}
                </Link>
              </Button>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default DashHero;
