import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, KeyObject } from 'node:crypto';
import {
  computeManifestDigest, verifyManifestSignature, _internals,
} from './manifest-signer.js';

// Helpers
function freshEd25519() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  // Extract the 32-byte raw public key from SPKI for base64-encoding
  // (the format the hosted registry will publish + PHANTOM will pin).
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const raw = spkiDer.subarray(spkiDer.length - 32); // last 32 bytes = key
  return {
    privateKey,
    publicKey,
    rawBase64: Buffer.from(raw).toString('base64'),
  };
}

function buildManifest({ id = 'test-pack', signature = null, digest = null, signedBy = 'phantom' } = {}) {
  return {
    schema: 'toolpack.phantom.dev/v1',
    identity: { id, name: 'Test', version: '1.0.0' },
    trust: {
      digest: digest || 'sha256:placeholder',
      signature: signature || 'placeholder',
      signed_by: signedBy,
    },
  };
}

describe('manifest-signer (B3 prep)', () => {
  test('computeManifestDigest: stable + deterministic', () => {
    const a = computeManifestDigest('hello world');
    const b = computeManifestDigest('hello world');
    assert.strictEqual(a, b);
    assert.match(a, /^sha256:[a-f0-9]{64}$/);
  });

  test('computeManifestDigest: distinct inputs produce distinct digests', () => {
    const a = computeManifestDigest('one');
    const b = computeManifestDigest('two');
    assert.notStrictEqual(a, b);
  });

  test('verifyManifestSignature: happy path with ed25519 round-trip', () => {
    const { privateKey, rawBase64 } = freshEd25519();
    const bytes = JSON.stringify({ identity: { id: 'web-recon' } });
    const digest = computeManifestDigest(bytes);
    const sigBuf = sign(null, Buffer.from(digest), privateKey);
    const manifest = buildManifest({
      digest,
      signature: sigBuf.toString('base64'),
      signedBy: 'phantom',
    });
    const result = verifyManifestSignature({
      manifestBytes: bytes,
      manifest,
      trustRootBase64: rawBase64,
      expectedSigner: 'phantom',
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.errors, []);
  });

  test('verifyManifestSignature: digest mismatch → rejected', () => {
    const { privateKey, rawBase64 } = freshEd25519();
    const bytes = '{"a":1}';
    const wrongDigest = 'sha256:' + '0'.repeat(64);
    const sigBuf = sign(null, Buffer.from(wrongDigest), privateKey);
    const manifest = buildManifest({
      digest: wrongDigest,
      signature: sigBuf.toString('base64'),
    });
    const result = verifyManifestSignature({
      manifestBytes: bytes, manifest, trustRootBase64: rawBase64,
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors[0].message, /digest mismatch/);
  });

  test('verifyManifestSignature: tampered signature → rejected', () => {
    const { privateKey, rawBase64 } = freshEd25519();
    const bytes = '{"a":1}';
    const digest = computeManifestDigest(bytes);
    const sigBuf = sign(null, Buffer.from(digest), privateKey);
    // Flip a byte in the signature
    const tampered = Buffer.from(sigBuf);
    tampered[0] = tampered[0] ^ 0xff;
    const manifest = buildManifest({
      digest, signature: tampered.toString('base64'),
    });
    const result = verifyManifestSignature({
      manifestBytes: bytes, manifest, trustRootBase64: rawBase64,
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors[0].message, /signature verification failed/);
  });

  test('verifyManifestSignature: wrong trust root → rejected', () => {
    const { privateKey } = freshEd25519();
    const { rawBase64: otherKey } = freshEd25519();
    const bytes = '{"a":1}';
    const digest = computeManifestDigest(bytes);
    const sigBuf = sign(null, Buffer.from(digest), privateKey);
    const manifest = buildManifest({
      digest, signature: sigBuf.toString('base64'),
    });
    const result = verifyManifestSignature({
      manifestBytes: bytes, manifest, trustRootBase64: otherKey,
    });
    assert.strictEqual(result.ok, false);
  });

  test('verifyManifestSignature: signed_by mismatch when expectedSigner is pinned', () => {
    const { privateKey, rawBase64 } = freshEd25519();
    const bytes = '{"a":1}';
    const digest = computeManifestDigest(bytes);
    const sigBuf = sign(null, Buffer.from(digest), privateKey);
    const manifest = buildManifest({
      digest, signature: sigBuf.toString('base64'),
      signedBy: 'rogue-issuer',
    });
    const result = verifyManifestSignature({
      manifestBytes: bytes, manifest, trustRootBase64: rawBase64,
      expectedSigner: 'phantom',
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors[0].message, /expected phantom/);
  });

  test('verifyManifestSignature: missing trust fields → reports them all', () => {
    const result = verifyManifestSignature({
      manifestBytes: '{}',
      manifest: { trust: {} },
      trustRootBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    assert.strictEqual(result.ok, false);
    const paths = result.errors.map((e) => e.path);
    assert.ok(paths.includes('trust.digest'));
    assert.ok(paths.includes('trust.signature'));
    assert.ok(paths.includes('trust.signed_by'));
  });

  test('verifyManifestSignature: invalid base64 signature → clean error', () => {
    const { rawBase64 } = freshEd25519();
    const manifest = buildManifest({
      digest: computeManifestDigest('hi'),
      signature: 'not-real-base64-data-but-too-short',
    });
    const result = verifyManifestSignature({
      manifestBytes: 'hi', manifest, trustRootBase64: rawBase64,
    });
    assert.strictEqual(result.ok, false);
    // Either "expected 64 bytes" length error OR a decode error
    assert.ok(result.errors.length >= 1);
  });

  test('spkiFromRawEd25519: rejects keys of the wrong length', () => {
    assert.throws(
      () => _internals.spkiFromRawEd25519(Buffer.alloc(16).toString('base64')),
      /ed25519 public key must be 32 raw bytes/,
    );
  });

  test('round-trip: same manifest produces the same digest across calls', () => {
    const bytes = JSON.stringify({ identity: { id: 'x' }, risk: { action_classes: ['recon'] } });
    const d1 = computeManifestDigest(bytes);
    const d2 = computeManifestDigest(bytes);
    const d3 = computeManifestDigest(Buffer.from(bytes));
    assert.strictEqual(d1, d2);
    assert.strictEqual(d2, d3);
  });
});
