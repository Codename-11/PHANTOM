// Persistent application shell: left sidebar nav + breadcrumb topbar.
//
// The React migration (A8.x) shipped each page as a standalone <main>
// with no shared chrome, so operators lost the legacy sidebar. This
// restores it. Nav routes mirror the legacy frontend/index.html sidebar
// (dash · chat · runs · graph · alerts · artifacts · approvals · scope ·
// campaigns · registry · settings). React-migrated routes navigate via
// react-router NavLink (SPA, no reload); routes still served by the
// legacy bundle (chat, registry, docs) use full-page anchors.
import * as React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  glyph: string;
  react: boolean;
}

const NAV: NavItem[] = [
  { to: '/dash', label: 'Dash', glyph: 'DSH', react: true },
  { to: '/chat', label: 'Chat', glyph: 'CMD', react: true },
  { to: '/runs', label: 'Runs', glyph: 'RUN', react: true },
  { to: '/graph', label: 'Graph', glyph: 'MAP', react: true },
  { to: '/alerts', label: 'Alerts', glyph: 'ALR', react: true },
  { to: '/artifacts', label: 'Artifacts', glyph: 'EVD', react: true },
  { to: '/approvals', label: 'Approvals', glyph: 'APV', react: true },
  { to: '/scope', label: 'Assets / Scope', glyph: 'SCP', react: true },
  { to: '/campaigns', label: 'Campaigns', glyph: 'CMP', react: true },
  { to: '/registry', label: 'Registry', glyph: 'REG', react: true },
  { to: '/settings', label: 'Settings', glyph: 'CFG', react: true },
];

const navItemClass = (active: boolean) =>
  cn(
    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'bg-[var(--cy-3)]/40 text-[var(--cy-fg)] border border-[var(--cy-2)]'
      : 'text-muted-foreground border border-transparent hover:bg-[var(--bg-3)] hover:text-foreground',
  );

const Glyph = ({ children }: { children: string }) => (
  <span
    aria-hidden="true"
    className="inline-flex w-9 shrink-0 justify-center font-mono text-[10px] tracking-[0.08em] text-[var(--fg-3)]"
  >
    {children}
  </span>
);

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const crumbs = useCrumbs();
  const { pathname } = useLocation();

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
        <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
          <span className="font-mono text-sm font-semibold tracking-[0.12em] text-foreground">
            PHANTOM
          </span>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--fg-3)]">
            SEC
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item) =>
            item.react ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => navItemClass(isActive)}
                title={item.label}
              >
                <Glyph>{item.glyph}</Glyph>
                <span className="truncate">{item.label}</span>
              </NavLink>
            ) : (
              <a key={item.to} href={item.to} className={navItemClass(false)} title={item.label}>
                <Glyph>{item.glyph}</Glyph>
                <span className="truncate">{item.label}</span>
                <span className="ml-auto font-mono text-[9px] text-[var(--fg-4)]">↗</span>
              </a>
            ),
          )}
        </nav>

        <div className="border-t border-border p-2">
          <a
            href="/docs/"
            target="_blank"
            rel="noopener"
            className={navItemClass(false)}
            title="User docs (opens in new tab)"
          >
            <Glyph>DOC</Glyph>
            <span className="truncate">Docs</span>
            <span className="ml-auto font-mono text-[9px] text-[var(--fg-4)]">↗</span>
          </a>
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
