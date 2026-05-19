# Guide

PHANTOM is a local-first command center for **authorized security research**. You run it on your own machine, point it at an OpenAI-compatible model endpoint, define a scope, and the agent operates inside it.

This guide walks you through the path from zero to first synthesis card:

1. **[Getting started](/guide/getting-started)** — clone, install, configure, run.
2. **[Onboarding wizard](/guide/onboarding-wizard)** — the 4-step modal that opens on a fresh install.
3. **[Your first run](/guide/first-run)** — drive a recon engagement end-to-end and read the synthesis.
4. **[Troubleshooting](/guide/troubleshooting)** — common failures and how to recover.

## Mental model

If you're skimming, here are the four ideas that shape every surface in PHANTOM:

**Runs.** Every chat turn that calls a tool creates a *run* — a persisted record with the prompt snapshot, scope, model, trace events, and durable artifacts. Refresh the browser, restart the server: the run is still there.

**Scope.** A scope is your *authorization boundary*. Targets (hosts, CIDRs, URLs), allowed action classes (recon, network-scan, exploit…), rules of engagement, expiry. Risky tool calls are evaluated against the active scope **before** they execute. Blocked actions become `tool.call.blocked` trace events; they don't run.

**Synthesis.** When a run terminates, the *Synthesis tab* leads with a one-glance answer: posture score, objective met/partial/unmet, what worked, what was blocked, what to do next. The same data shape feeds the Dashboard's posture trend and the onboarding wizard's preview.

**Approvals.** When the policy says "this needs operator approval," the agent's tool call pauses on an ask-gate. You approve or deny in chat; the decision and your note land in the audit trail. The Approvals page surfaces every gate decision — and pending sec-ops install requests — in one queue.

## Where to go next

- **New here?** → [Getting started](/guide/getting-started)
- **Wizard didn't open?** → [Onboarding wizard](/guide/onboarding-wizard)
- **Want the conceptual map?** → [Architecture overview](/architecture/)
- **Need API or config docs?** → [Reference](/reference/api)

::: warning Authorized use only
PHANTOM is designed for systems you own or have explicit written permission to assess. Scope policy gates reduce risk; they do not replace authorization, judgment, or environment isolation. See the [security page](/security) before pointing the agent at anything.
:::
