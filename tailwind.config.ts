// Tailwind config for PHANTOM's React bundle.
//
// Theme.extend.colors maps shadcn/ui's canonical token names to the
// cool-slate CSS variables already defined in frontend/css/styles.css
// (and mirrored in frontend/src/styles/globals.css for the React-only
// dev path). This is the contract that lets shadcn/ui primitives render
// pixel-identical to the existing hand-rolled components.
//
// A8.1 expands the surface so shadcn primitives that need accent, input,
// popover, secondary, and destructive-foreground tokens compile without
// resorting to ad-hoc colors. Every token resolves to an existing
// cool-slate variable — no new palette colors introduced.
import type { Config } from 'tailwindcss';
import animatePlugin from 'tailwindcss-animate';

const config: Config = {
  darkMode: 'class',
  content: ['./frontend/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--bg-0)',
        foreground: 'var(--fg-1)',
        card: 'var(--bg-2)',
        'card-foreground': 'var(--fg-1)',
        popover: 'var(--bg-2)',
        'popover-foreground': 'var(--fg-1)',
        muted: 'var(--bg-3)',
        'muted-foreground': 'var(--fg-3)',
        accent: 'var(--bg-3)',
        'accent-foreground': 'var(--fg-1)',
        secondary: 'var(--bg-3)',
        'secondary-foreground': 'var(--fg-1)',
        border: 'var(--line-1)',
        input: 'var(--line-2)',
        primary: 'var(--cy-1)',
        'primary-foreground': 'var(--bg-0)',
        destructive: 'var(--danger)',
        'destructive-foreground': 'var(--fg-1)',
        ring: 'var(--cy-1)',
        warn: 'var(--warn)',
        ok: 'var(--ok)',
        // ── Severity scale (warm — semantic only) ──────────────────────
        // Exposed so utilities can opt into the full kit severity palette
        // (e.g. text-sev-crit, bg-sev-high-bg, border-sev-med-line).
        'sev-crit': 'var(--sev-crit)',
        'sev-crit-bg': 'var(--sev-crit-bg)',
        'sev-crit-line': 'var(--sev-crit-line)',
        'sev-high': 'var(--sev-high)',
        'sev-high-bg': 'var(--sev-high-bg)',
        'sev-high-line': 'var(--sev-high-line)',
        'sev-med': 'var(--sev-med)',
        'sev-med-bg': 'var(--sev-med-bg)',
        'sev-med-line': 'var(--sev-med-line)',
        'sev-low': 'var(--sev-low)',
        'sev-low-bg': 'var(--sev-low-bg)',
        'sev-low-line': 'var(--sev-low-line)',
        'sev-info': 'var(--sev-info)',
        'sev-info-bg': 'var(--sev-info-bg)',
        'sev-info-line': 'var(--sev-info-line)',
        'sev-ok': 'var(--sev-ok)',
        'sev-ok-bg': 'var(--sev-ok-bg)',
        'sev-ok-line': 'var(--sev-ok-line)',
        // ── Governance (policy / blocked / redacted) ───────────────────
        policy: 'var(--policy)',
        'policy-bg': 'var(--policy-bg)',
        'policy-line': 'var(--policy-line)',
        redacted: 'var(--redacted)',
      },
      borderRadius: {
        // Mapped to the kit's --r-* radii scale. shadcn defaults (lg/md/sm)
        // are preserved; r1..r5/rpill expose the finer kit steps.
        lg: '8px',
        md: '6px',
        sm: '4px',
        r1: 'var(--r-1)',
        r2: 'var(--r-2)',
        r3: 'var(--r-3)',
        r4: 'var(--r-4)',
        r5: 'var(--r-5)',
        rpill: 'var(--r-pill)',
      },
      fontSize: {
        // Operator-dense scale from kit/tokens.css (--fs-*). Lets screens
        // address exact kit sizes via text-fs-11 etc. without arbitrary values.
        'fs-9': ['9px', { lineHeight: '1.25' }],
        'fs-10': ['10px', { lineHeight: '1.25' }],
        'fs-11': ['11px', { lineHeight: '1.4' }],
        'fs-12': ['12px', { lineHeight: '1.5' }],
        'fs-13': ['13px', { lineHeight: '1.5' }],
        'fs-15': ['15px', { lineHeight: '1.5' }],
        'fs-17': ['17px', { lineHeight: '1.4' }],
        'fs-20': ['20px', { lineHeight: '1.3' }],
        'fs-24': ['24px', { lineHeight: '1.2' }],
        'fs-32': ['32px', { lineHeight: '1.15' }],
        'fs-44': ['44px', { lineHeight: '1.1' }],
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animatePlugin],
};

export default config;
