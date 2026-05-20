// Tailwind config for PHANTOM's React bundle (Phase A8.0).
//
// Theme.extend.colors maps shadcn/ui's canonical token names to the
// cool-slate CSS variables already defined in frontend/css/styles.css
// (and mirrored in frontend/src/styles/globals.css for the React-only
// dev path). This is the contract that lets shadcn/ui primitives render
// pixel-identical to the existing hand-rolled components.
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./frontend/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--bg-0)',
        foreground: 'var(--fg-1)',
        card: 'var(--bg-2)',
        'card-foreground': 'var(--fg-1)',
        muted: 'var(--bg-3)',
        'muted-foreground': 'var(--fg-3)',
        border: 'var(--line-1)',
        primary: 'var(--cy-1)',
        'primary-foreground': 'var(--bg-0)',
        destructive: 'var(--danger)',
        ring: 'var(--cy-1)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
