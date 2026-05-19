---
layout: home

hero:
  name: PHANTOM
  text: Governed AI Security-Ops Cockpit
  tagline: Local-first command center for authorized security research. Every autonomous run is scope-checked, traced, replayable, and auditable.
  image:
    src: /logo.svg
    alt: PHANTOM mark
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Codename-11/PHANTOM

features:
  - icon: 🛡️
    title: Governed runs
    details: Every operation creates a run with scope, policy, prompt, model, and timing snapshot. Risky tool calls are evaluated against your active scope before they execute — blocked actions become trace events, not unauthorized commands.
  - icon: 🃏
    title: End-of-run synthesis
    details: When a run finishes, the Synthesis tab leads with a posture score (0–100), objective met/partial/unmet, activity counts, key findings, and clickable next-step buttons. Optionally enriched by the model itself.
  - icon: 📊
    title: Posture trending
    details: Dashboard panel that charts posture across your recent terminal runs — sparkline, per-scope breakdown, recent-runs timeline. See whether your posture is improving without rebuilding the metric somewhere else.
  - icon: 🧭
    title: First-run wizard
    details: A 4-step modal that walks you through provider, key, first scope, and previews the synthesis card before your first real run completes. Re-runnable any time from Settings.
  - icon: 📦
    title: Sec-Ops installer
    details: Detects your host package manager (winget · choco · scoop · apt · dnf · pacman · brew · wsl-apt) and installs standard red + blue tooling — nmap, metasploit, hashcat, wireshark, suricata, volatility — via approval-gated, traced commands.
  - icon: ✅
    title: One approvals queue
    details: Scope-gated ask events, allow-once cards, operator overrides, timeouts, and pending sec-ops install requests all surface in the same Approvals page. Single governance surface for every privileged action.
  - icon: 🕸️
    title: Trace-first replay
    details: Runs, Graph, and Artifacts all read from the same append-only trace stream. Refresh your browser, restart the server — your runs are still replayable from SQLite.
  - icon: 🔒
    title: Operator override mode
    details: A per-run toggle that bypasses scope gates for local lab testing while still classifying risk, redacting the override reason, and persisting a tool.call.override audit trace. Default operation stays governed.
---

<style>
:root {
  --ph-card-bg: var(--vp-c-bg-soft);
  --ph-card-border: var(--vp-c-divider);
  --ph-accent: #5fb6ff;
}
.dark { --ph-card-bg: var(--vp-c-bg-alt); }
.surface-grid {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: 1fr;
  margin: 2rem auto 0;
  max-width: 1152px;
  padding: 0 1.5rem;
}
@media (min-width: 768px) { .surface-grid { grid-template-columns: 1fr 1fr; } }
.surface-card {
  background: var(--ph-card-bg);
  border: 1px solid var(--ph-card-border);
  border-radius: 12px;
  padding: 1.5rem;
}
.surface-card h3 { margin: 0 0 .25rem; font-size: 1.25rem; }
.surface-card .surface-tag {
  font-size: .8rem;
  font-weight: 500;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}
.surface-card p { margin: .75rem 0; line-height: 1.55; }
.surface-card ul { padding-left: 1.1rem; margin: .5rem 0 1rem; }
.surface-card li { margin: .25rem 0; }
.surface-card .cta { display: inline-block; font-weight: 500; margin-top: .5rem; }
</style>

<div class="surface-grid">
  <div class="surface-card">
    <div class="surface-tag">For operators</div>
    <h3>Audit-grade autonomous runs</h3>
    <p>PHANTOM is a single-machine command center. You bring an OpenAI-compatible API endpoint, you define a scope, and the agent operates inside it — with every decision (allowed, blocked, approved, overridden) persisted as a replayable trace.</p>
    <ul>
      <li>Authorize a scope before any risky tool runs</li>
      <li>Watch the agent in chat, replay the run later</li>
      <li>Generate exec summaries, evidence bundles, and pentest reports as durable artifacts</li>
    </ul>
    <a class="cta" href="/PHANTOM/guide/getting-started.html">Get set up in 5 minutes →</a>
  </div>
  <div class="surface-card">
    <div class="surface-tag">For governance</div>
    <h3>Nothing privileged goes unrecorded</h3>
    <p>Every action class — recon, network-scan, exploit, destructive, credentialed, online-bruteforce — is classified before execution and gated by the scope policy. Ask-gates and allow-once cards keep humans in the loop without breaking flow.</p>
    <ul>
      <li>Scopes carry rules of engagement, expiry, and rate caps</li>
      <li>Operator override is a deliberate ceremony with full audit trace</li>
      <li>Sec-Ops installer follows the same approval queue as any other privileged action</li>
    </ul>
    <a class="cta" href="/PHANTOM/features/scopes-and-policy.html">Read the governance model →</a>
  </div>
</div>
