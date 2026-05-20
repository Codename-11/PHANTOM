# Toolpack Registry — Operator Guide

This document covers how PHANTOM consumes signed toolpack manifests
from local fixtures, private hosted registries (B3), and public
read-path mirrors (B5).

---

## Local fixtures

PHANTOM ships with every built-in toolpack also represented as a
schema-validated manifest under `server/registry/fixtures/`. These are
**unsigned** by design (placeholder digests like `sha256:0000...`) —
the JS registry remains the authoritative execution path; the
fixtures exist so the registry surface + diagnostics + parity check
have something to render.

The Registry page (`/registry` in the cockpit) lists every fixture
with a validity pill, a trust pill (`unsigned` for fixtures), risk
classes, tools, and the install plan.

---

## Private hosted signed registry (B3-full)

A private signed registry is the recommended distribution path for
operators running PHANTOM in a regulated environment. The contract:

### Source layout (static)

```
https://registry.example.dev/
  index.json
  index.json.sig
  revocations.json
  revocations.json.sig
  packages/
    web-recon/
      1.0.0/
        manifest.json
        manifest.json.sig
        sbom.json
        README.md
```

The hosted control plane (Postgres + signing service + object storage)
produces this layout from a submission/review workflow. PHANTOM
**only** consumes the static signed output — it never holds signing
keys or submission state.

### Adding a source

```sh
curl -X POST http://phantom.local/api/registry/sources \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Acme Sec-Ops Registry",
    "url": "https://registry.acme.dev",
    "channel": "stable",
    "signingKey": "<base64-ed25519-32-byte-raw-public-key>",
    "signingKeyId": "acme-prod-2026",
    "enabled": false
  }'
```

Sources **land disabled** by default. The operator must explicitly
enable browsing before any remote fetch happens.

### Verifying connectivity + signature

```sh
curl -X POST http://phantom.local/api/registry/sources/<id>/fetch
```

The response carries the verified `signatureStatus` and a `packageCount`.
Outcomes are persisted (`last_fetched_at`, `last_status`, `last_error`).

### Trust model

- Sources are **untrusted by default** — adding a source does NOT
  grant it any privileges.
- Without a `signingKey`, fetched manifests are treated as **unsigned**
  and never imported as enabled.
- A `signingKey` is a base64-encoded raw 32-byte ed25519 public key.
  PHANTOM wraps it in the SPKI prefix internally for signature
  verification via `node:crypto.verify(null, ...)`.
- Tampered bodies, missing signatures, signed-by mismatches, or
  invalid digests all cause the fetch to fail with a structured error.
- Registry content can **never** grant itself broader local policy.
  Scope, action-class, and approval gates remain authoritative.

---

## Revocations (B4-full)

Each source may publish a `revocations.json` (+ `.sig`) listing package
versions that should be **warned** or **blocked**. PHANTOM polls every
enabled source's revocation feed every 30 minutes and caches the
result in-process.

### Feed shape

```json
{
  "schema": "phantom.revocations/v1",
  "generated_at": "2026-05-20T15:30:00Z",
  "entries": [
    {
      "package": "web-recon",
      "versions": ["1.0.0", "1.0.1"],
      "severity": "warn",
      "reason": "CVE-2026-0001 in upstream nuclei",
      "replacement": "1.0.2",
      "issued_at": "2026-05-20T15:00:00Z"
    }
  ],
  "trust": {
    "digest": "sha256:...",
    "signature": "<base64>",
    "signed_by": "acme-prod-2026"
  }
}
```

- `warn` revocations surface a banner in the registry UI but do not
  block install. Operators can acknowledge.
- `block` revocations prevent install/enable entirely until the
  pinned `replacement` is selected (or an operator manually overrides
  via an approval).

### Operator queries

```sh
# Full list of cached revocations across every source
curl http://phantom.local/api/registry/revocations

# Trigger an immediate poll (don't wait 30 min)
curl -X POST http://phantom.local/api/registry/revocations/poll

# Check a specific package + version
curl 'http://phantom.local/api/registry/revocations/check?package=web-recon&version=1.0.0'
```

The Dash diagnostics card shows a `revocations` row that turns amber
when warn entries exist or red when block entries do.

---

## Public read path (B5)

A public registry is the same shape as a private one — it just
publishes its static signed catalog to a public CDN
(`https://registry.phantom.dev/`) with WAF + rate limits in front.
PHANTOM clients consume it identically: add it as a source with the
public signing key pinned, enable browsing, fetch.

### Recommended posture

- Always pin the public signing key explicitly. PHANTOM does not ship
  any default trust roots — operators choose what to trust.
- Set `channel: 'stable'` for production; `preview` / `dev` are
  intended for hosted-side maintainers, not regulated deployments.
- Treat the public catalog as **read-only**. Submissions, reviews,
  and signing happen on a separate, private control plane.

### Offline mirroring

Because the layout is static signed JSON, operators can:

```sh
# Mirror the catalog to local disk
mkdir -p /opt/phantom-mirror
rsync -av rsync://registry.phantom.dev/ /opt/phantom-mirror/

# Serve it from a static file host
python3 -m http.server --directory /opt/phantom-mirror 8443
```

Then add the local mirror as a PHANTOM source pointing at
`https://your-mirror.example/`. The pinned signing key is unchanged —
the signatures verify against the same trust root regardless of where
the bytes were fetched from.

---

## Diagnostics

The `/api/diagnostics` endpoint surfaces three registry-related
checks:

| Check | Reports |
|---|---|
| `registry` | Local manifest fixture count + validation status |
| `parity` | JS-registry ↔ manifest agreement per toolpack |
| `revocations` | Cached revocation feed summary (sources / entries / warn / block) |

Each check runs in parallel with a 500ms budget. The Dash readiness
card renders them as `ok` / `needs_setup` / `degraded` / `blocked`
status pills.

---

## See also

- `docs/plans/2026-05-20-phantom-mega-plan.md` — full mega-plan
  including the hosted control plane requirements.
- `server/registry/manifest-schema.json` — the `toolpack.phantom.dev/v1`
  schema definition.
- `server/registry/manifest-signer.js` — the ed25519 verifier.
- `server/registry/revocation-feed.js` — the revocation parser.
- `server/registry/remote-fetch.js` — the HTTP+verify pipeline.
- `server/registry/revocation-poller.js` — the 30-minute polling cache.
