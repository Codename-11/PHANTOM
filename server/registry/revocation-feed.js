// Revocation feed client (B4 prep).
//
// PHANTOM clients poll a revocation feed from each configured registry
// source. The hosted control plane (B3-full) will publish
// `revocations.json` (+ `.sig`); PHANTOM verifies the signature with
// the same ed25519 trust root used for manifests, then applies the
// revocations locally.
//
// Feed shape (versioned for forward-compat):
//   {
//     "schema": "phantom.revocations/v1",
//     "generated_at": "2026-05-20T15:30:00Z",
//     "entries": [
//       {
//         "package": "web-recon",
//         "versions": ["1.0.0", "1.0.1"],  // exact match OR semver range
//         "severity": "warn" | "block",
//         "reason": "CVE-XXXX-YYYY in upstream nuclei",
//         "replacement": "1.0.2",            // optional successor pinned by ops
//         "issued_at": "2026-05-20T...Z",
//         "acknowledged_at": null            // operator-only field
//       }
//     ],
//     "trust": { "digest": "...", "signature": "...", "signed_by": "..." }
//   }
//
// Behavior:
//   - `warn` revocations surface a banner in the registry UI but do NOT
//     prevent install — operators can acknowledge.
//   - `block` revocations prevent install/enable entirely until the
//     pinned `replacement` is selected OR an operator manually overrides
//     (operator override is an explicit approval-gated action in B3-full).
//   - Revocations are CUMULATIVE — the latest fetch replaces the local
//     mirror. A version that's no longer in the feed is implicitly
//     cleared.
//
// This module ONLY parses + verifies + indexes a feed. The polling
// schedule, persistence, and UI integration land in B4-full.

import { verifyManifestSignature, computeManifestDigest } from './manifest-signer.js';

const SCHEMA = 'phantom.revocations/v1';
const VALID_SEVERITIES = new Set(['warn', 'block']);

/**
 * Parse + validate a revocation feed JSON string.
 *
 * @param {string|object} feed       Either the raw JSON string OR a parsed object.
 * @param {object} [opts]
 * @param {string} [opts.trustRootBase64]  Optional ed25519 trust root.
 *                                         When provided, signature verification
 *                                         is enforced and the feed is rejected
 *                                         on failure.
 * @param {string} [opts.expectedSigner]   Optional pinned signer label.
 * @returns {{ ok, errors[], feed?: ParsedFeed, signatureStatus }}
 */
export function parseRevocationFeed(feed, opts = {}) {
  const errors = [];
  let raw;
  let parsed;

  if (typeof feed === 'string') {
    raw = feed;
    try { parsed = JSON.parse(feed); }
    catch (err) { return { ok: false, errors: [{ path: '$', message: `parse error: ${err.message}` }], signatureStatus: { status: 'invalid', detail: 'malformed JSON' } }; }
  } else if (feed && typeof feed === 'object') {
    parsed = feed;
    raw = JSON.stringify(feed);
  } else {
    return { ok: false, errors: [{ path: '$', message: 'feed must be a string or object' }], signatureStatus: { status: 'invalid', detail: 'wrong type' } };
  }

  if (parsed.schema !== SCHEMA) {
    errors.push({ path: 'schema', message: `expected "${SCHEMA}", got "${parsed.schema}"` });
  }
  if (!parsed.generated_at) errors.push({ path: 'generated_at', message: 'missing' });
  if (!Array.isArray(parsed.entries)) {
    errors.push({ path: 'entries', message: 'must be an array' });
  } else {
    parsed.entries.forEach((entry, i) => validateEntry(entry, i, errors));
  }
  if (errors.length) {
    return { ok: false, errors, signatureStatus: { status: 'invalid', detail: 'schema validation failed' } };
  }

  // Signature verification (optional — only when caller provides a trust root).
  let signatureStatus = { status: 'unsigned', detail: 'no trust root configured' };
  if (opts.trustRootBase64) {
    const trust = parsed.trust;
    if (!trust || !trust.digest || !trust.signature || !trust.signed_by) {
      return {
        ok: false,
        errors: [{ path: 'trust', message: 'feed declares signature verification but trust block is incomplete' }],
        signatureStatus: { status: 'invalid', detail: 'incomplete trust block' },
      };
    }
    // Signature is over the feed's body MINUS the trust block. Recompute
    // here so the signer + verifier agree on what to hash.
    const bodyForSign = { ...parsed };
    delete bodyForSign.trust;
    const bodyBytes = JSON.stringify(bodyForSign);
    const verify = verifyManifestSignature({
      manifestBytes: bodyBytes,
      manifest: { trust },
      trustRootBase64: opts.trustRootBase64,
      expectedSigner: opts.expectedSigner || null,
    });
    if (!verify.ok) {
      return {
        ok: false,
        errors: verify.errors,
        signatureStatus: { status: 'invalid', detail: verify.errors.map((e) => e.message).join('; ') },
      };
    }
    signatureStatus = { status: 'verified', detail: `signed by ${trust.signed_by}` };
  }

  return {
    ok: true,
    errors: [],
    signatureStatus,
    feed: indexFeed(parsed),
  };
}

function validateEntry(entry, i, errors) {
  const base = `entries[${i}]`;
  if (!entry || typeof entry !== 'object') {
    errors.push({ path: base, message: 'must be an object' });
    return;
  }
  if (!entry.package) errors.push({ path: `${base}.package`, message: 'missing' });
  if (!Array.isArray(entry.versions) || !entry.versions.length) {
    errors.push({ path: `${base}.versions`, message: 'must be a non-empty array' });
  }
  if (!VALID_SEVERITIES.has(entry.severity)) {
    errors.push({ path: `${base}.severity`, message: `must be one of: ${[...VALID_SEVERITIES].join(', ')}` });
  }
  if (!entry.reason) errors.push({ path: `${base}.reason`, message: 'missing' });
  if (!entry.issued_at) errors.push({ path: `${base}.issued_at`, message: 'missing' });
}

/**
 * Index a parsed feed by package id → entries[]. Callers ask
 * "what's the revocation state for package X version Y?" via
 * checkRevocation().
 */
function indexFeed(parsed) {
  const byPackage = new Map();
  for (const entry of parsed.entries || []) {
    if (!byPackage.has(entry.package)) byPackage.set(entry.package, []);
    byPackage.get(entry.package).push(entry);
  }
  return {
    schema: parsed.schema,
    generatedAt: parsed.generated_at,
    byPackage,
    entries: parsed.entries,
    raw: parsed,
  };
}

/**
 * Check if a given package@version is revoked according to a parsed
 * feed.
 *
 * @returns {{ status: 'ok' | 'warn' | 'block', entry?, replacement?, reason? }}
 */
export function checkRevocation(parsedFeed, packageId, version) {
  if (!parsedFeed?.byPackage) return { status: 'ok' };
  const entries = parsedFeed.byPackage.get(packageId);
  if (!entries?.length) return { status: 'ok' };
  // Exact-match the version (semver ranges are deferred to B4-full —
  // the v1 schema deliberately keeps version matching exact for safety).
  for (const entry of entries) {
    if (entry.versions.includes(version)) {
      return {
        status: entry.severity,
        entry,
        replacement: entry.replacement || null,
        reason: entry.reason,
      };
    }
  }
  return { status: 'ok' };
}

export { SCHEMA, computeManifestDigest as computeFeedDigest };
