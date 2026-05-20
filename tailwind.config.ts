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
      },
      borderRadius: {
        lg: '8px',
        md: '6px',
        sm: '4px',
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
