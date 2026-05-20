// Manifest signature verification (B3 prep).
//
// Implements a minisign-style ed25519 verifier for
// toolpack.phantom.dev/v1 manifests. Pure node:crypto — no external
// dependencies, no infrastructure. The hosted registry control plane
// (B3) will produce the matching signer; PHANTOM only ever VERIFIES.
//
// Decision matches mega-plan "Open decisions" #6: minisign-style
// detached ed25519 signatures with a migration path to sigstore/cosign
// later. Ed25519 keys are 32 bytes; signatures are 64 bytes. Both
// transport as base64 strings.
//
// Wire shape:
//   - A trust root is a base64-encoded ed25519 public key (32 bytes
//     raw). PHANTOM persists these as registry_sources.signing_key in
//     the schema added by B3.
//   - A manifest's trust block declares:
//       trust.digest    = "sha256:<hex>"   — content digest
//       trust.signature = "<base64>"       — ed25519(digest_bytes)
//       trust.signed_by = "<key-id>"       — operator-visible label
//   - The verifier is given the RAW manifest bytes (NOT the parsed
//     JSON — order matters for digest stability) and a trust-root key.
//   - Returns { ok, errors[] }. ok=true only when digest matches AND
//     signature verifies AND signed_by matches.

import { createHash, createPublicKey, verify } from 'node:crypto';

const ED25519_RAW_KEY_LEN = 32;
const ED25519_SIG_LEN = 64;

/**
 * Compute the digest a signer would have signed for this manifest.
 * Two callers use this:
 *   - The hosted control plane (B3) before signing.
 *   - The PHANTOM client, comparing against the declared trust.digest.
 *
 * @param {string|Buffer} manifestBytes  Raw manifest content (UTF-8 OK).
 * @returns {string}  "sha256:<hex>"
 */
export function computeManifestDigest(manifestBytes) {
  const h = createHash('sha256');
  h.update(manifestBytes);
  return 'sha256:' + h.digest('hex');
}

/**
 * Decode a base64 ed25519 raw public key into the SPKI form
 * createPublicKey wants. The hosted registry publishes raw keys (32
 * bytes) for compactness; this wraps them for crypto.verify.
 */
function spkiFromRawEd25519(base64RawKey) {
  const raw = Buffer.from(base64RawKey, 'base64');
  if (raw.length !== ED25519_RAW_KEY_LEN) {
    throw new Error(`ed25519 public key must be ${ED25519_RAW_KEY_LEN} raw bytes, got ${raw.length}`);
  }
  // SPKI prefix for Ed25519: 0x302a300506032b6570032100 (12 bytes) + the 32-byte key.
  // This is the OID-tagged DER wrapper for AlgorithmIdentifier{ed25519} + BIT STRING.
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, raw]),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Sign-side helper exposed for tests + the future hosted control plane.
 * NOT called by the PHANTOM runtime path. Takes a Node KeyObject (or a
 * raw PKCS#8 private key Buffer) and returns the base64 detached
 * signature over `computeManifestDigest(manifestBytes)`.
 *
 * Tests use crypto.generateKeyPairSync('ed25519') to produce a fresh
 * key pair; the resulting privateKey/publicKey objects round-trip
 * cleanly with this function + verifyManifestSignature.
 */
export function signManifest(manifestBytes, privateKey) {
  const digest = computeManifestDigest(manifestBytes);
  const sig = require('node:crypto').sign(null, Buffer.from(digest), privateKey);
  return sig.toString('base64');
}

/**
 * Verify a manifest's trust block against a known trust-root key.
 *
 * @param {object} args
 * @param {string|Buffer} args.manifestBytes  Raw manifest content.
 * @param {object} args.manifest              Parsed manifest object
 *                                            (we read trust.* from here).
 * @param {string} args.trustRootBase64       Base64 raw ed25519 pub key
 *                                            the operator pinned.
 * @param {string} [args.expectedSigner]      Optional expected key id;
 *                                            when given, manifest.trust
 *                                            .signed_by must match.
 * @returns {{ ok: boolean, errors: Array<{path,message}> }}
 */
export function verifyManifestSignature({ manifestBytes, manifest, trustRootBase64, expectedSigner = null }) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: [{ path: '$', message: 'manifest must be an object' }] };
  }
  const trust = manifest.trust || {};
  if (!trust.digest)    errors.push({ path: 'trust.digest',    message: 'missing' });
  if (!trust.signature) errors.push({ path: 'trust.signature', message: 'missing' });
  if (!trust.signed_by) errors.push({ path: 'trust.signed_by', message: 'missing' });
  if (errors.length) return { ok: false, errors };

  // 1. Digest match
  const computed = computeManifestDigest(manifestBytes);
  if (computed !== trust.digest) {
    errors.push({
      path: 'trust.digest',
      message: `digest mismatch — declared ${trust.digest}, computed ${computed}`,
    });
    return { ok: false, errors };
  }

  // 2. signed_by label match (when caller pinned an expectation)
  if (expectedSigner && trust.signed_by !== expectedSigner) {
    errors.push({
      path: 'trust.signed_by',
      message: `expected ${expectedSigner}, got ${trust.signed_by}`,
    });
    return { ok: false, errors };
  }

  // 3. Ed25519 signature verify over the digest bytes
  let pubKey;
  try { pubKey = spkiFromRawEd25519(trustRootBase64); }
  catch (err) {
    return { ok: false, errors: [{ path: '$.trustRoot', message: err.message }] };
  }

  let sigBuf;
  try { sigBuf = Buffer.from(trust.signature, 'base64'); }
  catch {
    return { ok: false, errors: [{ path: 'trust.signature', message: 'not valid base64' }] };
  }
  if (sigBuf.length !== ED25519_SIG_LEN) {
    return { ok: false, errors: [{ path: 'trust.signature', message: `expected ${ED25519_SIG_LEN} bytes, got ${sigBuf.length}` }] };
  }

  const ok = verify(null, Buffer.from(trust.digest), pubKey, sigBuf);
  if (!ok) {
    return { ok: false, errors: [{ path: 'trust.signature', message: 'signature verification failed' }] };
  }

  return { ok: true, errors: [] };
}

export const _internals = {
  ED25519_RAW_KEY_LEN,
  ED25519_SIG_LEN,
  spkiFromRawEd25519,
};
