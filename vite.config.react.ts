// React/Vite config for PHANTOM's Phase A8.0 infrastructure bundle.
//
// Coexists with vite.config.js (the legacy vanilla bundle): selected via
// `vite --config vite.config.react.ts`. Output lands in dist/react/ so the
// legacy build at frontend/dist/ stays untouched. server/index.js gates
// when (if at all) it serves the React bundle via the REACT_PAGES set.

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Source the API server port the same way vite.config.js does so the
  // dev proxy stays in sync with the Express server. PHANTOM_API_PORT is
  // preferred; PORT is honored as a fallback; 1337 is the historical
  // default.
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.PHANTOM_API_PORT || env.PORT) || 1337;
  return {
  plugins: [react()],
  root: resolve(__dirname, 'frontend/src'),
  base: '/react/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'frontend/src'),
    },
  },
  // Dev server proxy: forward API + WebSocket to the Express server so the
  // React bundle (now the canonical UI) works under `npm run dev`. Without
  // this, /api and /ws would hit Vite and fail. Set VITE_DISABLE_HMR=1 for
  // headless sandboxes that can't sustain the HMR WebSocket.
  server: {
    host: true,
    hmr: env.VITE_DISABLE_HMR ? false : undefined,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
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
  // setupFiles wires jest-dom matchers + Radix's required DOM shims.
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
  };
});
