// Topbar active-scope chip + selector.
//
// Mirrors the kit's `.scope-strip` (SCOPE · name · N targets · expires …) but,
// because the kit's `.scope-strip` CSS is not ported, it's styled with the
// same token-driven Tailwind (policy/cyan accent) AppShell uses for its own
// chrome. Clicking opens a Dialog listing every scope from `useScopes()`;
// picking one calls `setActiveScopeId(id)`, and a Clear option resets it.
import * as React from 'react';

import { useActiveScope } from '@/lib/activeScope';
import { countScopeTargets, useScopes } from '@/lib/scopes';
import { cn } from '@/lib/utils';
import type { ScopeRecord } from '@/lib/types';

import { IcShield } from './ui/icons';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

// Compact "expires …" hint. Future dates → "in 3d" / "in 5h"; past →
// "expired". Falsey / unparseable input renders nothing (caller guards).
function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}

// One-line summary appended after the scope name: "· N targets · expires …".
function scopeMeta(scope: ScopeRecord): string {
  const n = countScopeTargets(scope);
  const parts = [`${n} ${n === 1 ? 'target' : 'targets'}`];
  const exp = formatExpiry(scope.expires_at);
  if (exp) parts.push(`expires ${exp}`);
  return `· ${parts.join(' · ')}`;
}

export function ScopeStrip() {
  const [open, setOpen] = React.useState(false);
  const { activeScopeId, scope, setActiveScopeId } = useActiveScope();
  const scopes = useScopes().data ?? [];

  const pick = (id: string | null) => {
    setActiveScopeId(id);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="scope-strip"
        title={scope ? `Active scope: ${scope.name}` : 'No scope selected — click to set'}
        aria-label={scope ? `Active scope: ${scope.name}` : 'Set active scope'}
        className={cn(
          'hidden h-7 max-w-[clamp(8rem,22vw,20rem)] items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-mono leading-none',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex',
          scope
            ? 'border-[var(--cy-2)] bg-[var(--bg-2)] text-[var(--fg-2)] hover:border-[var(--cy-1)] hover:text-[var(--fg-1)]'
            : 'border-[var(--line-1)] bg-[var(--bg-2)] text-[var(--fg-3)] hover:border-[var(--line-2)] hover:text-[var(--fg-2)]',
        )}
      >
        <IcShield size={13} />
        {scope ? (
          <>
            <span className="text-[var(--cy-1)]">SCOPE</span>
            <span className="truncate text-[var(--fg-1)]">{scope.name}</span>
            <span className="hidden truncate text-[var(--fg-3)] md:inline">
              {scopeMeta(scope)}
            </span>
          </>
        ) : (
          <span className="truncate">No scope selected</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="scope-strip-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set active scope</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1 px-3 py-3">
            <button
              type="button"
              onClick={() => pick(null)}
              data-testid="scope-strip-clear"
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors',
                'hover:bg-[var(--bg-hover)]',
                activeScopeId == null ? 'text-[var(--fg-1)]' : 'text-[var(--fg-3)]',
              )}
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.06em]">
                Clear
              </span>
              <span className="text-[var(--fg-4)]">no active scope</span>
            </button>

            {scopes.length === 0 ? (
              <div className="px-2.5 py-3 text-[12px] text-[var(--fg-3)]">
                No scopes available.
              </div>
            ) : (
              scopes.map((s) => {
                const active = s.id === activeScopeId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pick(s.id)}
                    data-scope-id={s.id}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                      active
                        ? 'bg-[var(--bg-3)] text-[var(--fg-1)] shadow-[inset_2px_0_0_var(--cy-1)]'
                        : 'text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-1)]',
                    )}
                  >
                    <IcShield
                      size={14}
                      className={active ? 'text-[var(--cy-1)]' : 'text-[var(--fg-3)]'}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {s.name || s.id}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--fg-3)]">
                      {scopeMeta(s)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ScopeStrip;
