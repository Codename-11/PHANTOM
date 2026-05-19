---
title: Security & Responsible Use
---

# Security & Responsible Use

PHANTOM is built for **authorized security testing**. It is a power tool, and like any power tool the operator is responsible for using it inside the boundaries of authorization, ethics, and law.

This page covers the two things you actually need to know: who can use this safely, and how PHANTOM tries to keep your evidence + credentials from leaking.

## Who PHANTOM is for

PHANTOM is appropriate for:

- **Authorized internal pentests** against systems your employer owns and has explicitly scoped.
- **Bug bounty engagements** against programs with published rules of engagement.
- **Red team exercises** against fixtures, intentionally-vulnerable VMs, or systems your customer has authorized in writing.
- **Defensive analysis** against your own infrastructure (the blue tier of the installer covers this).
- **Security research** against systems you own, lab environments, and CTF challenges.

PHANTOM is **not** appropriate for:

- Testing systems you don't own and don't have written permission to assess.
- Production systems where you "think" you have permission but haven't confirmed.
- Any operation against critical infrastructure, healthcare, financial systems, or government systems without explicit, signed authorization.

Scope policy gates reduce risk; they do **not** grant authorization. If you point PHANTOM at a system without permission, you broke the law — PHANTOM's audit trail just makes that easier to prove.

## How PHANTOM protects credentials

- **API keys** are stored locally in the SQLite settings table. They're never sent off-device by PHANTOM (the LLM provider sees them on the outbound request; that's how the provider auth works). They're never returned by `GET /api/settings` — only masked to `••••••••<last 4>`.
- **Sudo passwords** (if you cache one for the installer's Linux mitigation) are stored in the same settings table and never returned by `GET /api/settings`. The cache is opt-in — clear it any time via Settings.
- **Credential references** in scopes (`credential_refs`) are **pointers**, not secrets. We expect operators to use vault keys or asset ids; PHANTOM stores them in the database verbatim and redacts them in run snapshots before display.
- **Prompt snapshots** persisted with each run pass through a redaction filter that strips `credential_refs` / `credentialRefs` arrays and recognized secret patterns in free-text fields.

## How PHANTOM protects audit trail integrity

- Every privileged action — auto, ask, allow-once, override, denied, blocked — persists at least one trace event before or after the action runs.
- The Approvals view is **reconstructed from `trace_events`** — there's no separate approval table to fall out of sync.
- Operator Override does **not** bypass classification or audit. It bypasses the gate only.
- Install requests are persisted before any approval. Cancelled requests stay in the table.
- Trace events are append-only — there's no `UPDATE trace_events` path in the codebase.

## What PHANTOM does NOT protect against

- A malicious operator with shell access. PHANTOM is single-machine and unauthenticated; if you let untrusted users log into the box that runs PHANTOM, they can drive the agent or read `phantom.db` directly.
- A prompt-injection attack that convinces the agent to do something unethical. The scope policy gate still blocks the actual call, but the agent's chat output may include attacker-controlled text. Treat agent output as you'd treat tool output — don't paste it into other privileged systems without review.
- An exfiltrated `phantom.db`. The file contains your API keys (encrypted only by file permissions), conversation history, scope policies, and trace events. Protect it like any sensitive local artifact.
- A compromised LLM provider. If your provider's endpoint is hijacked, the agent could be steered into actions you didn't intend. Scope gates still apply, but the operator-facing reasoning is whatever the (compromised) model says it is.

## What's still on the roadmap

- Encrypted-at-rest API keys in the settings table (currently relies on file permissions on `phantom.db`).
- Optional auth in front of the Express server for use behind a reverse proxy.
- Richer secret detection in run snapshots and trace previews (we redact obvious patterns; sophisticated secret formats slip through).

## Network exposure

The dev server binds to `localhost` by default. If you change `server/index.js` to bind `0.0.0.0` or front it with a reverse proxy without auth, you've opened the agent driver to your LAN. **Don't do that.** PHANTOM is local-first because the threat model assumes single-operator-per-machine.

If you need remote access:

1. Run PHANTOM bound to localhost.
2. Front it with a reverse proxy (Caddy, nginx, Tailscale Funnel, Cloudflare Tunnel).
3. Terminate TLS and auth at the proxy.
4. Restrict to a single source IP or a vetted set of users.

## Reporting security issues

If you find a vulnerability in PHANTOM itself (not in the systems you're testing), please open a private GitHub security advisory rather than a public issue:

[github.com/Codename-11/PHANTOM/security/advisories](https://github.com/Codename-11/PHANTOM/security/advisories)

For everything else — bugs, feature requests, doc improvements — open a regular issue.

## Disclaimer

PHANTOM is designed for **authorized security testing only**. Always obtain proper authorization before testing any system. The authors and contributors are not responsible for misuse.

---

For the technical deep dive on policy gates, classification, and the trace event vocabulary, see [Architecture → Governance model](/architecture/governance).
