// ⌘K command palette — the kit's signature interaction.
//
// A single global modal that fuzzy-filters across static navigation, live
// findings/assets/runs data, and a few quick actions, then jumps the router
// to the chosen result. Open-state lives in the shared zustand store
// (lib/commandStore) so the topbar trigger and the global keydown listener
// drive the same instance; the actual data queries mount lazily (only while
// the palette is open) via a child component that is rendered conditionally.
//
// Styling is pure ported kit CSS (.cmdk*, .kbd) — no hard-coded colour, no
// new tokens. Reference: kit/prototype.jsx `CmdKPalette`.
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useActiveScopeStore } from '@/lib/activeScope';
import { useCommandPalette } from '@/lib/commandStore';
import { useFindings } from '@/lib/findings';
import { countScopeTargets, useScopes, useScopeAssets } from '@/lib/scopes';
import { useRuns } from '@/lib/runs';
import {
  IcSearch,
  IcCockpit,
  IcAi,
  IcAlert,
  IcRuns,
  IcGraph,
  IcArtifact,
  IcTarget,
  IcAssets,
  IcShield,
  IcGrid,
  IcSettings,
  IcBolt,
  IcPlus,
  IcRefresh,
  type IconProps,
} from '@/components/ui/icons';
import { Kbd } from '@/components/ui/kit';

// A single, flattenable result row. `meta` is the right-aligned mono hint.
interface CmdItem {
  id: string;
  icon: React.ReactElement;
  label: string;
  meta?: string;
  // Either a route to navigate to or a side-effecting action; both close.
  route?: string;
  run?: () => void;
}

interface CmdGroup {
  label: string;
  items: CmdItem[];
}

const IC = (size = 14): IconProps => ({ size });

// Static navigation entries (always candidates, filtered by query).
const NAV_ITEMS: CmdItem[] = [
  { id: 'nav:dash', icon: <IcCockpit {...IC()} />, label: 'Dash', meta: 'G D', route: '/dash' },
  { id: 'nav:chat', icon: <IcAi {...IC()} />, label: 'Chat', meta: 'G C', route: '/chat' },
  { id: 'nav:alerts', icon: <IcAlert {...IC()} />, label: 'Alerts', meta: 'G A', route: '/alerts' },
  { id: 'nav:runs', icon: <IcRuns {...IC()} />, label: 'Runs', meta: 'G R', route: '/runs' },
  { id: 'nav:graph', icon: <IcGraph {...IC()} />, label: 'Graph', meta: 'G G', route: '/graph' },
  { id: 'nav:artifacts', icon: <IcArtifact {...IC()} />, label: 'Artifacts', route: '/artifacts' },
  { id: 'nav:campaigns', icon: <IcTarget {...IC()} />, label: 'Campaigns', route: '/campaigns' },
  { id: 'nav:scope', icon: <IcAssets {...IC()} />, label: 'Assets / Scope', meta: 'G S', route: '/scope' },
  { id: 'nav:approvals', icon: <IcShield {...IC()} />, label: 'Approvals', route: '/approvals' },
  { id: 'nav:registry', icon: <IcGrid {...IC()} />, label: 'Registry', route: '/registry' },
  { id: 'nav:settings', icon: <IcSettings {...IC()} />, label: 'Settings', route: '/settings' },
];

// Substring match across label + meta (case-insensitive). Empty query → all.
function matches(item: { label: string; meta?: string }, lc: string): boolean {
  if (!lc) return true;
  return (
    item.label.toLowerCase().includes(lc) ||
    (item.meta ?? '').toLowerCase().includes(lc)
  );
}

// True when focus is in an editable element that is NOT the palette's own
// input — used so ⌘K still toggles but bare typing in a form isn't hijacked.
function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.dataset?.cmdkInput === 'true') return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  );
}

export function CommandPalette() {
  const { open, setOpen, toggle } = useCommandPalette();

  // Global ⌘K / Ctrl+K toggle + Escape close. Always mounted so the shortcut
  // works from anywhere; the data subtree only mounts while `open`.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isToggle) {
        // ⌘K works even from inputs; never let the browser intercept it.
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
        return;
      }
      // Ignore everything else while typing in a non-palette field.
      if (isEditableTarget(e.target)) return;
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen, toggle]);

  if (!open) return null;
  return <CommandPaletteBody onClose={() => setOpen(false)} />;
}

// Mounted only while open, so the findings/scopes/assets/runs queries fire
// lazily (and reset cleanly) per the foundation's "don't be always-on" rule.
function CommandPaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveScopeId = useActiveScopeStore((s) => s.setActiveScopeId);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);

  // Live data — capped to a handful of rows each so the list stays a palette,
  // not a table. These only run because this component is conditionally mounted.
  const findings = useFindings({ limit: 50 }).data ?? [];
  const scopes = useScopes().data ?? [];
  const assets = useScopeAssets().data ?? [];
  const runs = useRuns().data ?? [];

  const lc = query.trim().toLowerCase();

  const groups: CmdGroup[] = React.useMemo(() => {
    const out: CmdGroup[] = [];

    // Navigation
    const nav = NAV_ITEMS.filter((i) => matches(i, lc));
    if (nav.length) out.push({ label: 'Navigation', items: nav });

    // Findings → /alerts/:id
    const findingItems: CmdItem[] = findings
      .map((f) => ({
        id: `fnd:${f.id}`,
        icon: <IcAlert {...IC()} />,
        label: f.title || f.id,
        meta: f.severity ? String(f.severity).toUpperCase() : undefined,
        route: `/alerts/${f.id}`,
      }))
      .filter((i) => matches(i, lc))
      .slice(0, 5);
    if (findingItems.length) out.push({ label: 'Findings', items: findingItems });

    // Assets / Scopes → /assets/:id and /scope/:id
    const assetItems: CmdItem[] = assets
      .map((a) => ({
        id: `ast:${a.id}`,
        icon: <IcAssets {...IC()} />,
        label: a.name || a.id,
        meta: a.type ?? 'asset',
        route: `/assets/${a.id}`,
      }))
      .filter((i) => matches(i, lc));
    const scopeItems: CmdItem[] = scopes
      .map((s) => ({
        id: `scp:${s.id}`,
        icon: <IcShield {...IC()} />,
        label: s.name || s.id,
        meta: 'scope',
        route: `/scope/${s.id}`,
      }))
      .filter((i) => matches(i, lc));
    const assetScope = [...assetItems, ...scopeItems].slice(0, 6);
    if (assetScope.length) out.push({ label: 'Assets / Scopes', items: assetScope });

    // Runs → /runs/:id
    const runItems: CmdItem[] = runs
      .map((r) => ({
        id: `run:${r.id}`,
        icon: <IcRuns {...IC()} />,
        label: r.title || r.goal || r.id,
        meta: r.status ? String(r.status) : undefined,
        route: `/runs/${r.id}`,
      }))
      .filter((i) => matches(i, lc))
      .slice(0, 5);
    if (runItems.length) out.push({ label: 'Runs', items: runItems });

    // Set scope — pick the active scope without leaving the current page.
    // These are side-effecting (run) items, not routes: they update the
    // shared active-scope state and close the palette.
    const setScopeItems: CmdItem[] = scopes
      .map((s) => {
        const n = countScopeTargets(s);
        return {
          id: `setscope:${s.id}`,
          icon: <IcShield {...IC()} />,
          label: s.name || s.id,
          meta: `${n} ${n === 1 ? 'target' : 'targets'}`,
          run: () => setActiveScopeId(s.id),
        };
      })
      .filter((i) => matches(i, lc))
      .slice(0, 6);
    if (setScopeItems.length) out.push({ label: 'Set scope', items: setScopeItems });

    // Actions
    const actions: CmdItem[] = [
      { id: 'act:new-scope', icon: <IcShield {...IC()} />, label: 'New scope', meta: 'N', route: '/scope/new' },
      { id: 'act:new-campaign', icon: <IcPlus {...IC()} />, label: 'New campaign', meta: 'C', route: '/campaigns/new' },
      {
        id: 'act:refresh',
        icon: <IcRefresh {...IC()} />,
        label: 'Refresh',
        meta: 'R',
        run: () => queryClient.invalidateQueries(),
      },
    ].filter((i) => matches(i, lc));
    if (actions.length) out.push({ label: 'Actions', items: actions });

    return out;
  }, [findings, scopes, assets, runs, lc, queryClient, setActiveScopeId]);

  // Flattened visible list — the keyboard cursor walks this.
  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep the active index in range as results change (e.g. query narrows).
  React.useEffect(() => {
    setActive((i) => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1)));
  }, [flat.length]);

  const select = React.useCallback(
    (item: CmdItem | undefined) => {
      if (!item) return;
      if (item.run) item.run();
      if (item.route) navigate(item.route);
      onClose();
    },
    [navigate, onClose],
  );

  // Arrow navigation + Enter select, scoped to the palette list.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        select(flat[active]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flat, active, select]);

  // Walking counter so each rendered item knows its flat index for `.active`.
  let cursor = -1;

  return (
    <div className="cmdk-backdrop" onClick={onClose} role="presentation">
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk-input">
          <IcSearch size={16} />
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            type="text"
            data-cmdk-input="true"
            aria-label="Search commands"
            placeholder="Search navigation, findings, assets, runs, commands…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="cmdk-list">
          {groups.map((g) => (
            <div key={g.label} className="cmdk-group">
              <div className="cmdk-group-label">{g.label}</div>
              {g.items.map((it) => {
                cursor += 1;
                const here = cursor;
                return (
                  <div
                    key={it.id}
                    className={`cmdk-item${here === active ? ' active' : ''}`}
                    role="option"
                    aria-selected={here === active}
                    onMouseEnter={() => setActive(here)}
                    onClick={() => select(it)}
                  >
                    {it.icon}
                    <span>{it.label}</span>
                    {it.meta ? <span className="meta">{it.meta}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 ? (
            <div className="cmdk-group">
              <div className="cmdk-group-label">No matches</div>
            </div>
          ) : null}
        </div>

        <div className="cmdk-ft">
          <span className="grp">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>navigate</span>
          </span>
          <span className="grp">
            <Kbd>↵</Kbd>
            <span>open</span>
          </span>
          <span className="grp">
            <Kbd>esc</Kbd>
            <span>close</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
