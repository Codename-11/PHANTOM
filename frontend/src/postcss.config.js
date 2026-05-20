// PostCSS config for PHANTOM's React bundle.
//
// Lives under frontend/src/ (the Vite `root` for vite.config.react.ts) so
// autodiscovery only fires when building the React bundle. The legacy
// vanilla Vite build (root: frontend/) and the VitePress docs build
// (root: user-docs/.vitepress/) both sit outside this directory and so
// never pick up Tailwind — they have no Tailwind classes to compile.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
