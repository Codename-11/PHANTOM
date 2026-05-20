import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDomStub, loadFrontendModule } from '../test-dom-stub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const presenterPath = resolve(__dirname, 'registry-presenter.js');

function loadPresenter() {
  const stub = createDomStub();
  loadFrontendModule(presenterPath, stub, 'RegistryPresenter');
  return stub.window.RegistryPresenter;
}

const SAMPLE_MANIFEST = {
  id: 'web-recon', version: '1.0.0', valid: true, errors: [],
  source: 'fixture',
  digest: 'sha256:abc', computedDigest: 'sha256:abc',
  identity: { name: 'Web recon', summary: 'HTTP fingerprint + headers' },
  risk: { action_classes: ['recon', 'network-scan'], scope_required: true },
  manifest: {
    identity: { id: 'web-recon', name: 'Web recon', version: '1.0.0', publisher: 'phantom', license: 'MIT', category: 'recon', summary: 'HTTP fingerprint' },
    trust: { digest: 'sha256:abc', signed_by: 'phantom' },
    risk: { action_classes: ['recon', 'network-scan'], scope_required: true },
    tools: [{ name: 'httpx', risk: 'recon', command: 'httpx' }],
    install: { recipes: [{ kind: 'go-install', module: 'httpx' }], privileges: [] },
    lifecycle: {},
  },
};

test('renderList: empty state when no manifests', () => {
  const P = loadPresenter();
  const html = P.renderList({ summary: { total: 0, valid: 0, invalid: 0 }, manifests: [] });
  assert.match(html, /No manifests found/);
});

test('renderList: shows summary + rows + valid badge', () => {
  const P = loadPresenter();
  const html = P.renderList({
    summary: { total: 1, valid: 1, invalid: 0 },
    manifests: [SAMPLE_MANIFEST],
  });
  assert.match(html, /total 1/);
  assert.match(html, /valid 1/);
  assert.match(html, /Web recon/);
  assert.match(html, /campaign-pill-completed/); // valid badge
});

test('renderList: invalid badge for failed manifests', () => {
  const P = loadPresenter();
  const html = P.renderList({
    summary: { total: 1, valid: 0, invalid: 1 },
    manifests: [{ ...SAMPLE_MANIFEST, valid: false, errors: [{ path: '/identity', message: 'missing id' }] }],
  });
  assert.match(html, /campaign-pill-failed/);
});

test('trustBadge: ✓ when declared digest matches computed', () => {
  const P = loadPresenter();
  const ok = P.trustBadge({ digest: 'sha256:abc', computedDigest: 'sha256:abc' });
  assert.match(ok, /trust ✓/);
});

test('trustBadge: unsigned when digests disagree', () => {
  const P = loadPresenter();
  const bad = P.trustBadge({ digest: 'sha256:abc', computedDigest: 'sha256:xyz' });
  assert.match(bad, /unsigned/);
});

test('renderDetail: surfaces identity + risk + tools + install', () => {
  const P = loadPresenter();
  const html = P.renderDetail(SAMPLE_MANIFEST, null);
  assert.match(html, /Identity/);
  assert.match(html, /Web recon/);
  assert.match(html, /Risk classes/);
  assert.match(html, /recon/);
  assert.match(html, /network-scan/);
  assert.match(html, /Tools \(1\)/);
  assert.match(html, /Install recipes/);
});

test('renderDetail: shows preview-install plan when supplied', () => {
  const P = loadPresenter();
  const preview = {
    plan: { recipes: [{ kind: 'go-install', module: 'httpx' }] },
    note: 'Preview only — no execution.',
  };
  const html = P.renderDetail(SAMPLE_MANIFEST, preview);
  assert.match(html, /Preview install plan/);
  assert.match(html, /Preview only/);
  assert.match(html, /Request install/);
});

test('renderDetail: surfaces validation errors for invalid manifest', () => {
  const P = loadPresenter();
  const m = { ...SAMPLE_MANIFEST, valid: false, errors: [{ path: '/identity', message: 'id is required' }] };
  const html = P.renderDetail(m, null);
  assert.match(html, /Manifest validation failed/);
  assert.match(html, /id is required/);
});

test('renderHeader: returns the right pill class for validity', () => {
  const P = loadPresenter();
  const ok = P.renderHeader(SAMPLE_MANIFEST);
  assert.match(ok.pill, /campaign-pill-completed/);
  const bad = P.renderHeader({ ...SAMPLE_MANIFEST, valid: false });
  assert.match(bad.pill, /campaign-pill-failed/);
});
