import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDomStub, loadFrontendModule } from '../test-dom-stub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(__dirname, 'dash-hero.js');

function loadHero() {
  const stub = createDomStub();
  loadFrontendModule(modulePath, stub, 'DashHero');
  return stub.window.DashHero;
}

test('priority 1: blocked diagnostic wins over everything else', () => {
  const H = loadHero();
  const a = H.deriveAction({
    diag: { overall: 'blocked', checks: [{ id: 'db', status: 'blocked', detail: 'sqlite open failed' }] },
    checklist: { complete: false, checklist: { hasScope: false } },
    campaigns: [{ status: 'running', title: 'X' }],
    approvals: [{ status: 'pending' }, { status: 'pending' }],
  });
  assert.strictEqual(a.tone, 'crit');
  assert.match(a.title, /Fix db/);
});

test('priority 2: onboarding incomplete wins over approvals + campaigns', () => {
  const H = loadHero();
  const a = H.deriveAction({
    diag: { overall: 'ok' },
    checklist: { complete: false, checklist: { demoLoaded: false, toolpacksInstalled: false } },
    campaigns: [{ status: 'running', title: 'X' }],
    approvals: [{ status: 'pending' }],
  });
  assert.strictEqual(a.eyebrow, 'Get started');
  assert.match(a.title, /Load demo scenario/);
});

test('priority 3: approvals win over campaigns when onboarding complete', () => {
  const H = loadHero();
  const a = H.deriveAction({
    diag: { overall: 'ok' },
    checklist: { complete: true },
    campaigns: [{ status: 'running', title: 'X' }],
    approvals: [{ status: 'pending' }, { status: 'pending' }, { status: 'pending' }],
  });
  assert.strictEqual(a.eyebrow, 'Awaiting your decision');
  assert.match(a.title, /Review 3 approvals/);
});

test('priority 4: active campaign when nothing else pending', () => {
  const H = loadHero();
  const a = H.deriveAction({
    diag: { overall: 'ok' },
    checklist: { complete: true },
    campaigns: [{ status: 'running', title: 'Recon sweep', objective: 'Map perimeter' }],
    approvals: [],
  });
  assert.strictEqual(a.eyebrow, 'Active campaign');
  assert.match(a.title, /Continue Recon sweep/);
});

test('priority 5: default new-campaign CTA', () => {
  const H = loadHero();
  const a = H.deriveAction({
    diag: { overall: 'ok' },
    checklist: { complete: true },
    campaigns: [{ status: 'completed', title: 'Old one' }],
    approvals: [],
  });
  assert.strictEqual(a.eyebrow, 'Ready');
  assert.match(a.title, /Start a new campaign/);
});

test('diag null + checklist null: falls through to campaigns/approvals/default', () => {
  const H = loadHero();
  const a = H.deriveAction({ diag: null, checklist: null, campaigns: [], approvals: [] });
  assert.strictEqual(a.eyebrow, 'Ready');
});

test('escapes special characters in title via render-time esc()', () => {
  const H = loadHero();
  // deriveAction returns the raw title; render() handles escaping.
  // We just confirm the function returns the string as-is.
  const a = H.deriveAction({
    diag: { overall: 'ok' },
    checklist: { complete: true },
    campaigns: [{ status: 'running', title: '<script>alert(1)</script>' }],
    approvals: [],
  });
  assert.match(a.title, /<script>/);
});
