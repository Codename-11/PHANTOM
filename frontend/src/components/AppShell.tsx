// Persistent application shell: left sidebar nav + breadcrumb topbar.
//
// Reworked for 1:1 parity with the design kit's shell.jsx: two labeled
// nav sections (Operations + Governance), line icons (16px) instead of
// text glyphs, per-item count badges wired to live data, and a footer
// showing the active model + a status dot. The kit's `.side*` CSS rules
// are replicated here with token-driven Tailwind utilities (cyan accent,
// inset active rail) because AppShell owns its own chrome and the shared
// CSS files are off-limits to this surface.
//
// All routes are React (A8 migration complete), so every nav item uses a
// react-router NavLink (SPA, no reload). Docs stays a footer anchor —
// it's served outside the SPA and opens in a new tab.
import * as React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { useNavCounts } from '@/lib/navCounts';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

import { PhantomMark } from './PhantomMark';
import {
  IcAi,
  IcAlert,
  IcArtifact,
  IcAssets,
  IcChain,
  IcCockpit,
  IcGraph,
  IcGrid,
  IcRuns,
  IcSettings,
  IcShield,
  IcDoc,
} from './ui/icons';

// Keys into NavCounts; `undefined` means "no badge wired for this item".
type CountKey = 'alerts' | 'runs' | 'approvals' | 'assets';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  count?: CountKey;
}

const NAV_OPERATIONS: NavItem[] = [
  { to: '/dash', label: 'Dash', icon: <IcCockpit size={16} /> },
  { to: '/chat', label: 'Chat', icon: <IcAi size={16} /> },
  { to: '/alerts', label: 'Alerts', icon: <IcAlert size={16} />, count: 'alerts' },
  { to: '/runs', label: 'Runs', icon: <IcRuns size={16} />, count: 'runs' },
  { to: '/graph', label: 'Graph', icon: <IcGraph size={16} /> },
  { to: '/artifacts', label: 'Artifacts', icon: <IcArtifact size={16} /> },
  { to: '/campaigns', label: 'Campaigns', icon: <IcChain size={16} /> },
  { to: '/scope', label: 'Assets / Scope', icon: <IcAssets size={16} />, count: 'assets' },
];

const NAV_GOVERNANCE: NavItem[] = [
  { to: '/approvals', label: 'Approvals', icon: <IcShield size={16} />, count: 'approvals' },
  { to: '/registry', label: 'Registry', icon: <IcGrid size={16} /> },
  { to: '/settings', label: 'Settings', icon: <IcSettings size={16} /> },
];

// `.side-link` + `.side-link.active` from kit.css, token-for-token:
// inactive = fg-2 text / fg-3 icon, hover = bg-hover + fg-1, active =
// bg-3 fill, fg-1 text, cyan inset rail, cyan icon.
const sideLinkClass = (active: boolean) =>
  cn(
    'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[12px] text-left',
    'transition-colors duration-[80ms] motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    '[&>svg]:text-[var(--fg-3)] [&>svg]:transition-colors',
    active
      ? 'bg-[var(--bg-3)] text-[var(--fg-1)] shadow-[inset_2px_0_0_var(--cy-1)] [&>svg]:text-[var(--cy-1)]'
      : 'text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-1)] hover:[&>svg]:text-[var(--fg-1)]',
  );

// `.side-link .ct` — mono pill, right-aligned, fg-3 on bg-3 with a hairline.
function CountBadge({ value }: { value: number }) {
  return (
    <span className="ml-auto rounded-full border border-[var(--line-1)] bg-[var(--bg-3)] px-1.5 py-px font-mono text-[10px] leading-none text-[var(--fg-3)]">
      {value}
    </span>
  );
}

function NavSection({
  label,
  items,
  counts,
}: {
  label: string;
  items: NavItem[];
  counts: ReturnType<typeof useNavCounts>;
}) {
  return (
    <div className="px-2 pb-1.5 pt-3">
      <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--fg-3)]">
        {label}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const count = item.count ? counts[item.count] : undefined;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => sideLinkClass(isActive)}
              title={item.label}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              {count != null ? <CountBadge value={count} /> : null}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

function titleize(seg: string): string {
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

// Build breadcrumb segments from the current path, ignoring the legacy
// /react preview prefix so crumbs read the same on both path families.
function useCrumbs(): { label: string; to?: string }[] {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean).filter((p) => p !== 'react');
  if (parts.length === 0) return [{ label: 'Dash' }];
  const crumbs: { label: string; to?: string }[] = [];
  let acc = '';
  parts.forEach((part, i) => {
    acc += `/${part}`;
    const isLast = i === parts.length - 1;
    // ID-looking segments (uuid / long hex) get truncated for display.
    const label = /^[0-9a-f-]{8,}$/i.test(part) ? `${part.slice(0, 8)}…` : titleize(part);
    crumbs.push(isLast ? { label } : { label, to: acc });
  });
  return crumbs;
}

// Footer model label — `provider · model` from /api/settings, mirroring
// the kit's "Hermes · gpt-4o-2026". Degrades gracefully while loading.
function useModelLabel(): string {
  const { data } = useSettings();
  if (!data) return 'Connecting…';
  const provider = data.provider?.trim();
  const model = data.model?.trim();
  if (provider && model) return `${provider} · ${model}`;
  return model || provider || 'No model';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const crumbs = useCrumbs();
  const { pathname } = useLocation();
  const counts = useNavCounts();
  const modelLabel = useModelLabel();

  // Close the mobile drawer on navigation.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-[var(--bg-1)] transition-transform duration-200 motion-reduce:transition-none md:static md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
      >
        {/* .side-hd — brand mark + GOVERNED OPS sub-label */}
        <div className="flex h-11 items-center gap-2.5 border-b border-border px-3.5">
          <PhantomMark size={26} />
          <span className="font-mono text-[12px] font-semibold leading-none tracking-[0.14em] text-[var(--fg-1)]">
            PHANTOM SEC
            <span className="mt-0.5 block font-normal tracking-[0.1em] text-[9px] text-[var(--fg-3)]">
              GOVERNED OPS
            </span>
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto" aria-label="Sections">
          <NavSection label="Operations" items={NAV_OPERATIONS} counts={counts} />
          <NavSection label="Governance" items={NAV_GOVERNANCE} counts={counts} />
        </nav>

        {/* Docs — secondary footer link, opens outside the SPA */}
        <div className="px-2 py-2">
          <a
            href="/docs/"
            target="_blank"
            rel="noopener"
            className={cn(sideLinkClass(false))}
            title="User docs (opens in new tab)"
          >
            <IcDoc size={16} />
            <span className="truncate">Docs</span>
            <span className="ml-auto font-mono text-[9px] text-[var(--fg-4)]">↗</span>
          </a>
        </div>

        {/* .side-ft — status dot + active model */}
        <div className="mt-auto flex items-center gap-2.5 border-t border-border px-3 py-2.5 text-[11px] text-[var(--fg-3)]">
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--sev-ok)] shadow-[0_0_8px_var(--sev-ok-line)]"
            aria-hidden="true"
          />
          <span className="grow truncate font-mono">{modelLabel}</span>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-[var(--bg-1)]/95 px-4 backdrop-blur">
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
          >
            ☰
          </button>
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
              {crumbs.map((c, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {i > 0 ? <span className="text-[var(--fg-4)]">/</span> : null}
                  {c.to ? (
                    <Link to={c.to} className="transition-colors hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="text-foreground">{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export default AppShell;
