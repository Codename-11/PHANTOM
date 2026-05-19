import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/PHANTOM/',
  title: 'PHANTOM',
  description: 'PHANTOM — Governed AI Security-Ops Cockpit. Trace-first runs, policy-gated tools, durable evidence, graph replay.',

  head: [
    // Favicon — base path is NOT auto-applied to head entries in VitePress,
    // so hard-prefix with /PHANTOM/ to match the GitHub Pages deploy.
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/PHANTOM/logo.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/PHANTOM/logo.svg' }],

    // Canonical
    ['link', { rel: 'canonical', href: 'https://codename-11.github.io/PHANTOM/' }],

    // Open Graph — crawlers need absolute URLs for previews on Slack/Discord/etc.
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'PHANTOM' }],
    ['meta', { property: 'og:title', content: 'PHANTOM — Governed AI Security-Ops Cockpit' }],
    ['meta', { property: 'og:description', content: 'Local-first command center for authorized security research with scoped autonomous runs, policy-gated tools, durable traces, artifacts, and graph replay.' }],
    ['meta', { property: 'og:url', content: 'https://codename-11.github.io/PHANTOM/' }],
    ['meta', { property: 'og:image', content: 'https://codename-11.github.io/PHANTOM/og-image.png' }],
    ['meta', { property: 'og:image:secure_url', content: 'https://codename-11.github.io/PHANTOM/og-image.png' }],
    ['meta', { property: 'og:image:type', content: 'image/png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'PHANTOM — Governed AI Security-Ops Cockpit.' }],

    // Twitter / X Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'PHANTOM — Governed AI Security-Ops Cockpit' }],
    ['meta', { name: 'twitter:description', content: 'Trace-first runs, policy-gated tools, durable evidence, graph replay.' }],
    ['meta', { name: 'twitter:image', content: 'https://codename-11.github.io/PHANTOM/og-image.png' }],
    ['meta', { name: 'twitter:image:alt', content: 'PHANTOM — Governed AI Security-Ops Cockpit.' }],

    // Theme — matches PHANTOM SEC UI Kit base background.
    ['meta', { name: 'theme-color', content: '#0a0c10' }],

    // Fonts — Inter + JetBrains Mono mirror the in-app type stack.
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap', rel: 'stylesheet' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/features/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Reference', link: '/reference/api' },
      { text: 'GitHub', link: 'https://github.com/Codename-11/PHANTOM' },
      { text: 'Security', link: '/security' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Overview', link: '/guide/' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Onboarding wizard', link: '/guide/onboarding-wizard' },
            { text: 'Your first run', link: '/guide/first-run' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          ],
        },
      ],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Overview', link: '/features/' },
            { text: 'End-of-run synthesis card', link: '/features/synthesis-card' },
            { text: 'Posture trending', link: '/features/posture-trending' },
            { text: 'Sec-Ops installer', link: '/features/sec-ops-installer' },
            { text: 'Scopes & policy gates', link: '/features/scopes-and-policy' },
            { text: 'Approvals queue', link: '/features/approvals' },
            { text: 'Operator Override', link: '/features/operator-override' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'Governance model', link: '/architecture/governance' },
            { text: 'Agent loop', link: '/architecture/agent-loop' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'REST + WebSocket API', link: '/reference/api' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Synthesis data shape', link: '/reference/synthesis-shape' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Codename-11/PHANTOM' },
    ],

    footer: {
      message: 'PHANTOM is for <a href="/PHANTOM/security">authorized security testing only</a>. MIT License.',
      copyright: '© Codename-11 / Axiom-Labs',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/Codename-11/PHANTOM/edit/main/user-docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
