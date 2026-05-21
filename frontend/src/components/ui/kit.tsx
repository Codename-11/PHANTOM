// PHANTOM SEC — kit primitives (React).
//
// Thin, typed React wrappers around the kit's semantic CSS classes
// (frontend/src/styles/kit-components.css), mirroring the design kit's
// primitives.jsx. Screens compose these instead of improvising with
// generic shadcn surfaces — that improvisation is what "minified" the
// React port away from the concept. Each component emits exactly the
// class the kit defined, so the rendering matches the source of truth.
import * as React from 'react';

import { cn } from '@/lib/utils';

export type Severity = 'crit' | 'high' | 'med' | 'low' | 'info' | 'ok';
export type StatKind = 'info' | 'crit' | 'ok' | 'cyan' | 'policy';

const STAT_KIND_COLOR: Record<StatKind, string> = {
  info: 'var(--fg-1)',
  crit: 'var(--sev-crit)',
  ok: 'var(--sev-ok)',
  cyan: 'var(--cy-1)',
  policy: 'var(--policy)',
};

// ── Panel ────────────────────────────────────────────────────────────
// Card with the kit's gradient header, padded/flush body, optional footer.
export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  flush?: boolean;
  bodyClassName?: string;
}

export function Panel({
  title,
  sub,
  actions,
  footer,
  flush,
  bodyClassName,
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <section className={cn('panel', className)} {...rest}>
      {title != null && (
        <header className="panel-hd">
          <span className="title">{title}</span>
          {sub != null && <span className="caption" style={{ marginLeft: 8 }}>{sub}</span>}
          {actions != null && <span className="actions">{actions}</span>}
        </header>
      )}
      <div className={cn('panel-bd', flush && 'flush', bodyClassName)}>{children}</div>
      {footer != null && <footer className="panel-ft">{footer}</footer>}
    </section>
  );
}

// ── Stat ─────────────────────────────────────────────────────────────
// Metric card with mono key / large value / delta. Lives inside a flex
// row so the per-card border-right divider reads as a strip.
export interface StatProps {
  k: React.ReactNode;
  v: React.ReactNode;
  d?: React.ReactNode;
  kind?: StatKind;
  /** delta direction — `up` reads as worse (red), `dn` as better (green). */
  trend?: 'up' | 'dn';
  className?: string;
  style?: React.CSSProperties;
}

export function Stat({ k, v, d, kind = 'info', trend, className, style }: StatProps) {
  return (
    <div className={cn('stat', className)} style={style}>
      <div className="k">{k}</div>
      <div className="v" style={{ color: STAT_KIND_COLOR[kind] }}>{v}</div>
      {d != null && <div className={cn('d', trend === 'up' && 'up', trend === 'dn' && 'dn')}>{d}</div>}
    </div>
  );
}

// ── SevTick ──────────────────────────────────────────────────────────
// 3px severity edge for the left of an alert/table row.
export function SevTick({ s, className }: { s: Severity; className?: string }) {
  return <span className={cn('sev-tick', s, className)} aria-hidden="true" />;
}

// ── Chip / TargetChip ────────────────────────────────────────────────
export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  k?: React.ReactNode;
  v?: React.ReactNode;
  pressed?: boolean;
  onRemove?: () => void;
}

export function Chip({ k, v, pressed, onRemove, className, children, ...rest }: ChipProps) {
  return (
    <span className={cn('chip', className)} aria-pressed={pressed} {...rest}>
      {k != null && <span className="k">{k}:</span>}
      {v != null && <span className="v">{v}</span>}
      {children}
      {onRemove && (
        <button type="button" className="x" onClick={onRemove} aria-label="Remove">
          ✕
        </button>
      )}
    </span>
  );
}

export interface TargetChipProps {
  kind: React.ReactNode;
  value: React.ReactNode;
  onRemove?: () => void;
  className?: string;
}

export function TargetChip({ kind, value, onRemove, className }: TargetChipProps) {
  return (
    <span className={cn('chip target', className)}>
      <span className="kind">{kind}</span>
      <span>{value}</span>
      {onRemove && (
        <button type="button" className="x" onClick={onRemove} aria-label="Remove target">
          ✕
        </button>
      )}
    </span>
  );
}

// ── Bar ──────────────────────────────────────────────────────────────
export function Bar({
  pct,
  kind,
  className,
}: {
  pct: number;
  kind?: 'crit' | 'high' | 'med' | 'ok';
  className?: string;
}) {
  return (
    <div className={cn('bar', kind, className)}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

// ── Spark ────────────────────────────────────────────────────────────
// Inline mini bar-history. `data` values are pixel heights (1..14).
export function Spark({ data = [], crit, className }: { data?: number[]; crit?: boolean; className?: string }) {
  return (
    <span className={cn('spark', crit && 'crit', className)}>
      {data.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(2, v)}px` }} />
      ))}
    </span>
  );
}

// ── Kv ───────────────────────────────────────────────────────────────
export interface KvItem {
  k: React.ReactNode;
  v: React.ReactNode;
  /** render the value in the sans font instead of mono. */
  sans?: boolean;
}

export function Kv({ items, className }: { items: KvItem[]; className?: string }) {
  return (
    <dl className={cn('kv', className)}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <dt>{it.k}</dt>
          <dd className={it.sans ? 'sans' : undefined}>{it.v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// ── ButtonGroup (segmented control) ──────────────────────────────────
export interface SegOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

export function ButtonGroup<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegOption<T>[];
  className?: string;
}) {
  return (
    <div className={cn('btn-group', className)} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="btn btn-sm"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Kbd ──────────────────────────────────────────────────────────────
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('kbd', className)}>{children}</span>;
}
