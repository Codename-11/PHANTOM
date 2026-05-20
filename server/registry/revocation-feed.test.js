import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { parseRevocationFeed, checkRevocation, SCHEMA } from './revocation-feed.js';
import { computeManifestDigest } from './manifest-signer.js';

function freshEd25519() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const raw = spkiDer.subarray(spkiDer.length - 32);
  return { privateKey, rawBase64: Buffer.from(raw).toString('base64') };
}

function validFeed() {
  return {
    schema: SCHEMA,
    generated_at: '2026-05-20T15:30:00Z',
    entries: [
      {
        package: 'web-recon',
        versions: ['1.0.0', '1.0.1'],
        severity: 'warn',
        reason: 'CVE-2026-0001 upstream',
        replacement: '1.0.2',
        issued_at: '2026-05-20T15:00:00Z',
      },
      {
        package: 'old-pack',
        versions: ['0.9.0'],
        severity: 'block',
        reason: 'maintainer compromised',
        issued_at: '2026-05-19T12:00:00Z',
      },
    ],
  };
}

function signFeed(feed, privateKey, signedBy = 'phantom') {
  const body = { ...feed };
  delete body.trust;
  const bodyBytes = JSON.stringify(body);
  const digest = computeManifestDigest(bodyBytes);
  const sig = sign(null, Buffer.from(digest), privateKey);
  return { ...feed, trust: { digest, signature: sig.toString('base64'), signed_by: signedBy } };
}

describe('revocation-feed (B4 prep)', () => {
  test('parses a valid feed', () => {
    const result = parseRevocationFeed(validFeed());
    assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
    assert.strictEqual(result.feed.entries.length, 2);
    assert.ok(result.feed.byPackage.has('web-recon'));
  });

  test('accepts feed as JSON string OR object', () => {
    const obj = validFeed();
    const asObject = parseRevocationFeed(obj);
    const asString = parseRevocationFeed(JSON.stringify(obj));
    assert.strictEqual(asObject.ok, true);
    assert.strictEqual(asString.ok, true);
  });

  test('rejects wrong schema', () => {
    const bad = { ...validFeed(), schema: 'phantom.revocations/v999' };
    const result = parseRevocationFeed(bad);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.find((e) => e.path === 'schema'));
  });

  test('rejects missing required entry fields', () => {
    const bad = validFeed();
    bad.entries[0] = { package: 'x', versions: [] }; // missing severity + reason
    const result = parseRevocationFeed(bad);
    assert.strictEqual(result.ok, false);
    const paths = result.errors.map((e) => e.path);
    assert.ok(paths.some((p) => p.includes('versions')));
    assert.ok(paths.some((p) => p.includes('severity')));
    assert.ok(paths.some((p) => p.includes('reason')));
  });

  test('rejects malformed JSON when given a string', () => {
    const result = parseRevocationFeed('not json{{{');
    assert.strictEqual(result.ok, false);
    assert.match(result.errors[0].message, /parse error/);
  });

  test('checkRevocation: ok for unrelated package', () => {
    const r = parseRevocationFeed(validFeed());
    const out = checkRevocation(r.feed, 'unrelated-pack', '1.0.0');
    assert.strictEqual(out.status, 'ok');
  });

  test('checkRevocation: warn severity surfaces replacement', () => {
    const r = parseRevocationFeed(validFeed());
    const out = checkRevocation(r.feed, 'web-recon', '1.0.0');
    assert.strictEqual(out.status, 'warn');
    assert.strictEqual(out.replacement, '1.0.2');
    assert.match(out.reason, /CVE/);
  });

  test('checkRevocation: block severity', () => {
    const r = parseRevocationFeed(validFeed());
    const out = checkRevocation(r.feed, 'old-pack', '0.9.0');
    assert.strictEqual(out.status, 'block');
  });

  test('checkRevocation: version not in the revoked list → ok', () => {
    const r = parseRevocationFeed(validFeed());
    const out = checkRevocation(r.feed, 'web-recon', '2.0.0');
    assert.strictEqual(out.status, 'ok');
  });

  test('signature verification: happy path with valid ed25519 sig', () => {
    const { privateKey, rawBase64 } = freshEd25519();
    const signed = signFeed(validFeed(), privateKey);
    const result = parseRevocationFeed(signed, {
      trustRootBase64: rawBase64,
      expectedSigner: 'phantom',
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
    assert.strictEqual(result.signatureStatus.status, 'verified');
  });

  test('signature verification: missing trust block → rejected when root configured', () => {
    const { rawBase64 } = freshEd25519();
    const result = parseRevocationFeed(validFeed(), { trustRootBase64: rawBase64 });
    assert.strictEqual(result.ok, false);
    assert.match(result.signatureStatus.detail, /incomplete trust block/);
  });

  test('signature verification: tampered body → rejected', () => {
    const { privateKey, rawBase64 } = freshEd25519();
    const signed = signFeed(validFeed(), privateKey);
    // Tamper with an entry AFTER signing
    signed.entries[0].versions.push('666.6.6');
    const result = parseRevocationFeed(signed, { trustRootBase64: rawBase64 });
    assert.strictEqual(result.ok, false);
  });

  test('no trust root configured → signatureStatus=unsigned but parse still ok', () => {
    const result = parseRevocationFeed(validFeed());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.signatureStatus.status, 'unsigned');
  });
});
