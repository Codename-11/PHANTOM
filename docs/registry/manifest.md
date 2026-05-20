# Toolpack Manifest Reference (`toolpack.phantom.dev/v1`)

> **Invariant:** manifests **describe** capability — they never **execute** it.
> Install recipes must be declarative arrays; shell-string and script-string
> recipes are rejected by the validator.

This page is the field reference for the v1 manifest schema. The canonical
schema lives at
[`server/registry/manifest-schema.json`](../../server/registry/manifest-schema.json)
and the validator at
[`server/registry/manifest-validator.js`](../../server/registry/manifest-validator.js).

Built-in fixtures live in
[`server/registry/fixtures/`](../../server/registry/fixtures/). Each shipped
toolpack has a corresponding `<id>.manifest.json`.

---

## Top-level shape

```json
{
  "schema": "toolpack.phantom.dev/v1",
  "identity":      { ... },
  "compatibility": { ... },
  "trust":         { ... },
  "risk":          { ... },
  "install":       { ... },
  "tools":         [ ... ],
  "prompt":        { ... },
  "outputs":       { ... },
  "templates":     { ... },
  "docs":          { ... },
  "review":        { ... },
  "lifecycle":     { ... }
}
```

The `schema` field must be exactly `"toolpack.phantom.dev/v1"`. All thirteen
top-level keys (including `schema`) are required. Unknown top-level keys are
rejected.

---

## Sections

### `identity`

| Field         | Type   | Required | Notes |
| ------------- | ------ | -------- | ----- |
| `id`          | string | yes      | Slug-style: `^[a-z][a-z0-9-]*[a-z0-9]$`. |
| `name`        | string | yes      | Human-readable name. |
| `summary`     | string | yes      | One-sentence summary. |
| `category`    | string | yes      | e.g. `osint`, `web`, `network`, `vulnerability`, `passwords`, `reporting`. |
| `version`     | string | yes      | SemVer. |
| `channel`     | enum   | yes      | `stable` \| `beta` \| `experimental` \| `builtin`. |
| `publisher`   | object | yes      | `{ id, name, url? }`. |
| `license`     | string | yes      | SPDX identifier preferred. |
| `homepage`    | string | no       | URL. |

### `compatibility`

| Field                | Type     | Required | Notes |
| -------------------- | -------- | -------- | ----- |
| `phantom_min`        | semver   | yes      | Minimum PHANTOM version. |
| `phantom_max`        | semver   | no       | Inclusive maximum. |
| `platforms`          | string[] | yes      | One or more of `linux`, `darwin`, `windows`, `docker`. |
| `container_profiles` | string[] | no       | Container profiles (e.g. `base`, `web`, `network`). |

### `trust`

| Field          | Type   | Required | Notes |
| -------------- | ------ | -------- | ----- |
| `digest`       | string | **yes**  | `sha256:<64 hex>`. Required by schema. |
| `signature`    | string | no       | Detached signature payload. |
| `signed_by`    | string | no       | Signing key identity (e.g. fingerprint). |
| `provenance`   | object | no       | `{ source?, attestation_ref?, build_ref? }`. |

### `risk`

| Field              | Type             | Required | Notes |
| ------------------ | ---------------- | -------- | ----- |
| `action_classes`   | actionClass[]    | **yes**  | Non-empty, unique. See table below. |
| `default_allowed`  | actionClass[]    | no       | Operator-allowed by default. |
| `default_ask`      | actionClass[]    | no       | Prompted for approval. |
| `default_deny`     | actionClass[]    | no       | Denied unless overridden. |
| `scope_required`   | bool             | no       | If true, runs must reference an active scope. |
| `target_required`  | bool             | no       | If true, runs must reference an explicit target. |
| `rate_caps`        | object           | no       | `{ requests_per_second?, concurrent?, max_runtime_seconds? }`. |
| `network_egress`   | object           | no       | `{ allowed, destinations[]? }`. |
| `credential_rules` | object           | no       | `{ allow_credential_use?, allow_online_login?, offline_only?, passive_only? }`. |

### `install`

```json
{
  "recipes": [
    { "kind": "apt",         "packages": ["nmap"] },
    { "kind": "go-install",  "module":   "github.com/projectdiscovery/httpx/cmd/httpx@latest" },
    { "kind": "git-clone",   "repo": "...", "ref": "main", "dest": "~/tools/x" },
    { "kind": "docker-pull", "image": "registry.example/x:1.2.3", "checksum": "sha256:..." }
  ],
  "privilege": { "requires_root": false, "requires_docker": false, "capabilities": ["CAP_NET_RAW"] },
  "rollback":  { "recipes": [ ... ], "hints": [ "..." ] }
}
```

**Forbidden recipe properties** (`not` clause in the schema): `shell`,
`script`, `command`, `run`, `exec`. Any recipe carrying one of those is
rejected. `additionalProperties: false` also blocks arbitrary
recipe-level keys.

Allowed `kind` values:

| Kind            | Use |
| --------------- | --- |
| `apt`, `apt-get`, `dnf`, `yum`, `pacman`, `apk` | Linux system packages. |
| `brew`          | macOS / Homebrew. |
| `pipx`, `pip`   | Python packages. |
| `go-install`    | `go install <module>`. |
| `cargo-install` | `cargo install <pkg>`. |
| `npm`           | npm package. |
| `docker-pull`   | Container image (`image`, optional `checksum`). |
| `git-clone`     | `repo`, `ref`, `dest`. |
| `fetch-binary`  | `url`, required `checksum`, optional `dest`. |
| `noop`          | Documentation-only placeholder. |

### `tools`

Array of:

| Field              | Type      | Required | Notes |
| ------------------ | --------- | -------- | ----- |
| `name`             | string    | yes      | Display name. |
| `command`          | string    | yes      | Binary on PATH after install. |
| `risk_class`       | riskClass | yes      | See risk class table below. |
| `scope_required`   | bool      | no       | If true, scope must be set to run. |
| `target_required`  | bool      | no       | If true, target must be set to run. |
| `gated`            | bool      | no       | Default-deny; explicit approval required. |
| `level`            | string    | no       | Capability level (e.g. `basic`, `kali`). |
| `parser`           | string    | no       | Parser id (matches `outputs.parsers[].id`). |
| `expected_outputs` | string[]  | no       | Parser ids the tool typically emits. |
| `install_hint`     | string    | no       | Human-readable install hint. |

### `prompt`

```json
{
  "playbook": "Use passive sources first...",
  "fragments": [
    { "id": "scope-check", "text": "Always verify scope before...", "reviewed": true }
  ]
}
```

Fragments are descriptive, not enforcement. Policy gates live in
PHANTOM's runtime, not in manifest prompt text.

### `outputs`

```json
{
  "parsers":  [ { "id": "nmap_xml_or_text", "kind": "xml-or-text" } ],
  "findings": [ { "id": "web-vuln-finding", "title": "...", "severity_hint": "medium" } ],
  "reports":  [ { "id": "exec-summary",     "format": "markdown" } ]
}
```

`severity_hint` is one of `info`, `low`, `medium`, `high`, `critical`.

### `templates`

```json
{
  "scopes":    [ { "id": "...", "title": "...", "description": "..." } ],
  "campaigns": [ ... ],
  "reports":   [ ... ],
  "evidence":  [ ... ]
}
```

### `docs`

```json
{
  "readme": "Short description in markdown.",
  "examples": [ { "id": "quickstart", "title": "Quickstart", "path": "examples/quickstart.md" } ]
}
```

### `review`

```json
{
  "status": "approved",
  "reviewed_by": "phantom-builtin",
  "reviewed_at": "2026-05-20",
  "flags": {
    "exploit": false, "destructive": false, "credentialed": false,
    "network_egress": true, "requires_secrets": false
  },
  "notes": "Optional reviewer notes."
}
```

`status`: `unreviewed` \| `in-review` \| `approved` \| `rejected`.

### `lifecycle`

```json
{
  "status": "active",
  "deprecation": { "since": "2027-01-01", "reason": "..." },
  "revocation":  { "at": "2027-06-01",    "reason": "..." },
  "replacement": { "id": "newer-pack",    "min_version": "2.0.0" }
}
```

`status`: `active` \| `deprecated` \| `revoked`.

---

## Action class reference

`risk.action_classes` lists what the toolpack is permitted to do.
Default-allow / ask / deny lists are subsets of `action_classes`.

| Action class              | Meaning |
| ------------------------- | ------- |
| `recon`                   | Passive or low-impact discovery. |
| `read/local`              | Reads local files; no network egress. |
| `network-scan`            | Active port/service enumeration of scoped targets. |
| `exploit`                 | Exploit-class operations (gated by default). |
| `destructive`             | Operations that mutate or damage state. |
| `credentialed`            | Uses operator credentials against scoped services. |
| `online-bruteforce`       | Online password guessing against scoped services. |
| `offline-password-audit`  | Offline hash audit against operator-supplied material. |
| `credential-stuffing`     | Reuse of leaked credentials across services. |
| `spraying`                | Low-rate password spraying across many accounts. |

## Risk class reference

`tools[].risk_class` annotates individual tools. Policy gates map risk
class to runtime enforcement.

| Risk class                | Meaning |
| ------------------------- | ------- |
| `recon`                   | Passive discovery; lowest gating. |
| `read/local`              | Local file ops; no network. |
| `network-scan`            | Active scanning; requires scope. |
| `exploit`                 | Exploit-class; default gated. |
| `destructive`             | Mutating operations; default denied. |
| `offline-password-audit`  | Local hash cracking; offline only. |
| `online-bruteforce`       | Online auth probing; requires scope, target, rate caps. |

---

## Validation

```js
import { validateManifest } from './server/registry/manifest-validator.js';

const { ok, errors } = validateManifest(parsedManifest);
if (!ok) {
  console.error(errors);
}
```

Error shape: `{ instancePath, schemaPath, message }`.

The validator covers the draft-07 subset used by this schema (`type`,
`const`, `enum`, `pattern`, `required`, `additionalProperties`,
`properties`, `items`, `minItems`, `minLength`, `minimum`, `maximum`,
`uniqueItems`, `$ref` to local `#/definitions/...`, `not`, and `anyOf`).
It does not pull in any new dependencies.

Run the test suite:

```bash
node --test server/registry/manifest-validator.test.js
```

The suite covers the acceptance criteria from B0:

- valid v1 manifest accepted,
- unknown schema version rejected,
- unknown action class rejected,
- unknown risk class rejected,
- shell-string / script-string install recipes rejected,
- missing required `trust.digest` rejected,
- empty `risk.action_classes` rejected,
- every built-in fixture validates.
