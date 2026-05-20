import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDomStub, loadFrontendModule } from '../test-dom-stub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const formPath = resolve(__dirname, 'campaign-form.js');

function loadForm() {
  const stub = createDomStub();
  loadFrontendModule(formPath, stub, 'CampaignForm');
  return stub.window.CampaignForm;
}

test('DEFAULT_STATE returns safe defaults', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  assert.strictEqual(s.backend, 'phantom-native');
  assert.strictEqual(s.runBudget.maxChildRuns, 10);
  // Use deepEqual (loose) — values come from a vm sandbox so their
  // prototypes don't match the host realm's Array/Object.
  assert.deepEqual(Array.from(s.riskBudget.blockedRiskClasses), [
    'exploit', 'destructive', 'credentialed', 'online-bruteforce',
  ]);
});

test('validate: title + objective required', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  const v = F.validate(s);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.title);
  assert.ok(v.errors.objective);
});

test('validate: scope required when network/security risk class is allowed', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  s.title = 'C'; s.objective = 'O';
  // default allowed = [read/local, recon] → recon needs scope
  let v = F.validate(s);
  assert.ok(v.errors.scopeId, 'recon should require scope');
  // remove the scoped risk class → no scope required
  s.riskBudget.allowedRiskClasses = ['read/local'];
  v = F.validate(s);
  assert.strictEqual(v.ok, true);
  assert.ok(!v.errors.scopeId);
});

test('validate: codex-exec requires a workdir', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  s.title = 'C'; s.objective = 'O';
  s.riskBudget.allowedRiskClasses = ['read/local'];
  s.backend = 'codex-exec';
  const v = F.validate(s);
  assert.ok(v.errors.workdir);
});

test('toCreatePayload: maps state to API body', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  s.title = '  Map AdminPortal  ';
  s.objective = 'find admins';
  s.scopeId = 'scope-a';
  s.toolpackIds = ['web-recon'];
  s.backend = 'codex-exec';
  s.workdir = '/lab';
  const body = F.toCreatePayload(s);
  assert.strictEqual(body.title, 'Map AdminPortal');
  assert.strictEqual(body.objective, 'find admins');
  assert.strictEqual(body.scopeId, 'scope-a');
  assert.deepEqual(Array.from(body.toolpackIds), ['web-recon']);
  assert.strictEqual(body.workerBackend, 'codex-exec');
  assert.strictEqual(body.notificationPolicy.workdir, '/lab');
});

test('toCreatePayload: phantom-native backend leaves notificationPolicy null', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  s.title = 'X'; s.objective = 'Y';
  const body = F.toCreatePayload(s);
  assert.strictEqual(body.notificationPolicy, null);
});

test('render: emits chip-picker + segmented + risk-grid markup', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  const refs = {
    scopes: [{ id: 'scope-a', name: 'Lab A' }],
    profiles: [{ id: 'p1', name: 'Default' }],
    toolpacks: [{ id: 'web-recon', name: 'Web recon', risks: ['recon'] }],
    backends: [{ id: 'phantom-native', available: true }, { id: 'codex-exec', available: false }],
  };
  const html = F.render(s, refs);
  // Field sections
  assert.match(html, /cf-section-title/);
  assert.match(html, /Identity/);
  assert.match(html, /Governance/);
  assert.match(html, /Tools &amp; worker/);
  assert.match(html, /Budgets/);
  // Chip-picker shows toolpacks
  assert.match(html, /data-cf-chip="web-recon"/);
  // Segmented backend with codex-exec disabled
  assert.match(html, /data-cf-segmented="backend"/);
  assert.match(html, /data-value="codex-exec"[^>]*disabled/);
  // Risk grid renders both locked and unlocked rows
  assert.match(html, /data-cf-risk="exploit"/);
  assert.match(html, /cf-risk-row locked/);
  // Live prompt preview
  assert.match(html, /cf-prompt-preview/);
});

test('render: scope select gains cf-error class when scope is required but empty', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  s.title = 't'; s.objective = 'o';
  // default state already allows recon → scope required → error class
  const html = F.render(s, { scopes: [], profiles: [], toolpacks: [], backends: [] });
  assert.match(html, /id="cf-scopeId"[^>]*class="cf-error"/);
  assert.match(html, /scope is required because/);
});

test('setField: writes nested paths', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  F.setField(s, 'runBudget.maxChildRuns', '7');
  assert.strictEqual(s.runBudget.maxChildRuns, '7');
  F.setField(s, 'title', 'hi');
  assert.strictEqual(s.title, 'hi');
});

test('generatePromptPreview: substitutes objective and risk classes', () => {
  const F = loadForm();
  const s = F.DEFAULT_STATE();
  s.objective = 'Map the lab.';
  s.riskBudget.allowedRiskClasses = ['recon'];
  const preview = F.generatePromptPreview(s, { scopes: [] });
  assert.match(preview, /Map the lab\./);
  assert.match(preview, /Allowed risk classes: recon/);
});
