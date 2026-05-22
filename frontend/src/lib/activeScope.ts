// Active-scope selection — the operator's "I'm working inside this scope"
// state, surfaced as the topbar scope-strip and the ⌘K "Set scope" group.
//
// Only the *id* is persisted (localStorage key `phantom-active-scope`); the
// full record is resolved on demand against the live `useScopes()` query so
// the strip never goes stale relative to /api/scopes. Page-level data
// filtering by the active scope is intentionally out of scope here — this is
// just the shared selection + the UI that drives it.
import { create } from 'zustand';

import { useScopes } from './scopes';
import type { ScopeRecord } from './types';

const STORAGE_KEY = 'phantom-active-scope';

function readStored(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.length ? v : null;
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — selection just won't persist */
  }
}

interface ActiveScopeState {
  activeScopeId: string | null;
  setActiveScopeId: (id: string | null) => void;
}

export const useActiveScopeStore = create<ActiveScopeState>((set) => ({
  activeScopeId: readStored(),
  setActiveScopeId: (id) => {
    writeStored(id);
    set({ activeScopeId: id });
  },
}));

export interface UseActiveScopeResult {
  activeScopeId: string | null;
  // The resolved record, or null when nothing is selected OR the selected id
  // no longer matches any live scope (e.g. it was deleted server-side).
  scope: ScopeRecord | null;
  setActiveScopeId: (id: string | null) => void;
}

// Convenience hook: resolves the persisted id against the live scope list and
// returns the active record (or null) plus the setter. Components that only
// need to set the id can use `useActiveScopeStore` directly.
export function useActiveScope(): UseActiveScopeResult {
  const activeScopeId = useActiveScopeStore((s) => s.activeScopeId);
  const setActiveScopeId = useActiveScopeStore((s) => s.setActiveScopeId);
  const scopes = useScopes().data ?? [];
  const scope = activeScopeId
    ? scopes.find((s) => s.id === activeScopeId) ?? null
    : null;
  return { activeScopeId, scope, setActiveScopeId };
}
