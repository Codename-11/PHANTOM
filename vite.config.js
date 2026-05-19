import { defineConfig, loadEnv } from 'vite';

// Source the API server port from .env so changing it keeps the proxy in
// sync. PHANTOM_API_PORT is preferred; PORT is honored as a fallback. The
// preferred var is namespaced because some dev-tool wrappers (e.g. the Claude
// Preview MCP) export PORT to the child shell to track their own preview
// port, which would otherwise force Express onto Vite's port and collide.
// Default 1337 matches the historical default.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.PHANTOM_API_PORT || env.PORT) || 1337;
  return {
    root: 'frontend',
    server: {
      host: true,
      port: 5173,
      // HMR client must connect back through the same host:port the page was
      // served from — otherwise the in-page Vite client logs repeated
      // "failed to connect to websocket" and never settles. Set
      // VITE_DISABLE_HMR=1 to fully disable (useful for headless preview
      // sandboxes that can't sustain the HMR WebSocket).
      hmr: env.VITE_DISABLE_HMR ? false : { host: 'localhost', clientPort: 5173 },
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
        '/ws':  { target: `ws://localhost:${apiPort}`,   ws: true },
      },
    },
  };
});
