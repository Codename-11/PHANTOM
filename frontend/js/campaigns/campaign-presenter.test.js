import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDomStub, loadFrontendModule } from '../test-dom-stub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const presenterPath = resolve(__dirname, 'campaign-presenter.js');

function loadPresenter() {
  const stub = createDomStub();
  loadFrontendModule(presenterPath, stub, 'CampaignPresenter');
  return stub.window.CampaignPresenter;
}

test('renderList: empty state when no campaigns', () => {
  const P = loadPresenter();
  const html = P.renderList([]);
  assert.match(html, /campaigns-empty/);
  assert.match(html, /POST \/api\/campaigns/);
});

test('renderList: row per campaign with status pill + budgets', () => {
  const P = loadPresenter();
  const html = P.renderList([
    {
      id: 'c1', title: 'Map AdminPortal', objective: 'find admins', status: 'running',
      worker_backend: 'phantom-native', toolpack_ids: ['web-recon', 'reporting'],
      run_budget: { maxChildRuns: 5, maxAttemptsPerGoal: 2 },
    },
  ]);
  assert.match(html, /campaign-row/);
  assert.match(html, /campaign-pill-running/);
  assert.match(html, /Map AdminPortal/);
  assert.match(html, /web-recon, reporting/);
  assert.match(html, /runs cap: 5/);
  assert.match(html, /attempts\/goal: 2/);
});

test('renderList: long objective is truncated with ellipsis', () => {
  const P = loadPresenter();
  const long = 'x'.repeat(300);
  const html = P.renderList([
    { id: 'c1', title: 't', objective: long, status: 'draft', worker_backend: 'phantom-native', run_budget: {} },
  ]);
  assert.match(html, /…/);
  // Truncated at 200 + ellipsis — way short of 300
  assert.ok(!html.includes('x'.repeat(250)));
});

test('statusChip escapes the status value defensively', () => {
  const P = loadPresenter();
  const chip = P.statusChip('"><script>alert(1)</script>');
  assert.ok(!chip.includes('<script>'));
  assert.match(chip, /&lt;script&gt;/);
});
