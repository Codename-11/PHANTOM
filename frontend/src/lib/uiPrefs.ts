// Operator display preferences — theme (dark/light) + density
// (operator/compact), the kit's "Tweaks" axes.
//
// globals.css defines the overrides as `:root[data-theme="light"]` and
// `:root[data-density="compact"]`, so applying a pref is just toggling an
// attribute on <html>. Dark + operator are the defaults (no attribute).
// Prefs persist to localStorage and apply immediately; `initUiPrefs()` is
// called once at app start so a reload restores the operator's choice.
import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export type Density = 'operator' | 'compact';

const THEME_KEY = 'phantom-theme';
const DENSITY_KEY = 'phantom-density';

function applyTheme(theme: Theme) {
  const el = document.documentElement;
  if (theme === 'light') el.setAttribute('data-theme', 'light');
  else el.removeAttribute('data-theme');
}

function applyDensity(density: Density) {
  const el = document.documentElement;
  if (density === 'compact') el.setAttribute('data-density', 'compact');
  else el.removeAttribute('data-density');
}

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

interface UiPrefsState {
  theme: Theme;
  density: Density;
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
}

export const useUiPrefs = create<UiPrefsState>((set) => ({
  theme: 'dark',
  density: 'operator',
  setTheme: (theme) => {
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
    set({ theme });
  },
  setDensity: (density) => {
    applyDensity(density);
    try { localStorage.setItem(DENSITY_KEY, density); } catch { /* ignore */ }
    set({ density });
  },
}));

// Read persisted prefs and apply them. Call once before/at first render so
// the DOM reflects the operator's saved choice without a flash.
export function initUiPrefs() {
  const theme = readStored<Theme>(THEME_KEY, 'dark', ['dark', 'light']);
  const density = readStored<Density>(DENSITY_KEY, 'operator', ['operator', 'compact']);
  applyTheme(theme);
  applyDensity(density);
  useUiPrefs.setState({ theme, density });
}
