// React/Vite config for PHANTOM's Phase A8.0 infrastructure bundle.
//
// Coexists with vite.config.js (the legacy vanilla bundle): selected via
// `vite --config vite.config.react.ts`. Output lands in dist/react/ so the
// legacy build at frontend/dist/ stays untouched. server/index.js gates
// when (if at all) it serves the React bundle via the REACT_PAGES set.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'frontend/src'),
  base: '/react/',
  // PostCSS plugins are inlined here so they pick up the repo-root
  // tailwind.config.ts explicitly. We avoid relying on postcss.config.js
  // autodiscovery because the legacy Vite build (root: frontend/) and
  // VitePress (root: user-docs/) sit close enough that the wrong config
  // could be picked up; inlining is unambiguous.
  css: {
    postcss: {
      plugins: [tailwindcss(resolve(__dirname, 'tailwind.config.ts')), autoprefixer()],
    },
  },
  build: {
    // dist/react/ relative to the repo root, i.e. ../../dist/react relative
    // to the configured `root`.
    outDir: resolve(__dirname, 'dist/react'),
    emptyOutDir: true,
    manifest: true,
    sourcemap: true,
  },
  // Vitest config inherits from this file. Tests run in jsdom so the
  // wrapper's AbortController/fetch interop behaves like the browser.
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    css: false,
  },
});
