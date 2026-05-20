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

test('renderList: empty state points at the new + New campaign button', () => {
  const P = loadPresenter();
  const html = P.renderList([]);
  assert.match(html, /campaigns-empty/);
  assert.match(html, /No campaigns yet/);
  assert.match(html, /\+ New campaign/);
});

test('renderList: row per campaign with status pill + budgets + clickable affordance', () => {
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
  // Row is a clickable target now.
  assert.match(html, /tabindex="0"/);
  assert.match(html, /role="button"/);
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

// ── Detail drawer panes ────────────────────────────────────────────────

function fakeReplay(overrides = {}) {
  return {
    campaign: {
      id: 'c1', title: 'Recon Sweep', objective: 'map the lab',
      status: 'running', worker_backend: 'phantom-native',
      scope_id: 'scope-a', toolpack_ids: ['web-recon', 'reporting'],
      started_at: '2026-05-20T10:00:00Z', ended_at: null,
      run_budget: { maxChildRuns: 10, maxAttemptsPerGoal: 2, maxWallClockMinutes: 120 },
      risk_budget: { allowedRiskClasses: ['read/local', 'recon'], blockedRiskClasses: ['exploit'] },
      ...overrides.campaign,
    },
    goals: overrides.goals ?? [],
    runs: overrides.runs ?? [],
    summary: { totalRuns: 0, totalFindings: 0, totalArtifacts: 0, totalBlocked: 0,
               budgetUsed: { runs: 0, maxRuns: 10 }, ...overrides.summary },
  };
}

test('renderOverviewPane: shows backend, KPIs, risk chips', () => {
  const P = loadPresenter();
  const html = P.renderOverviewPane(fakeReplay({
    summary: { totalRuns: 3, totalFindings: 1, totalArtifacts: 2, totalBlocked: 0 },
  }));
  assert.match(html, /campaign-meta-dl/);
  assert.match(html, /phantom-native/);
  assert.match(html, /campaign-kpi-grid/);
  assert.match(html, /kpi-num">3</);   // totalRuns
  assert.match(html, /read\/local/);
  // Blocked classes render with the block modifier.
  assert.match(html, /campaign-chip block">exploit/);
});

test('renderGoalsPane: empty-state when no goals', () => {
  const P = loadPresenter();
  const html = P.renderGoalsPane(fakeReplay());
  assert.match(html, /No goals queued yet/);
});

test('renderGoalsPane: timeline row per goal with evaluator verdict', () => {
  const P = loadPresenter();
  const html = P.renderGoalsPane(fakeReplay({
    goals: [{
      id: 'g1', title: 'Resolve', prompt: 'Run resolve_hostname',
      status: 'completed', attempt_count: 1, max_attempts: 2,
      evaluator_result: { decision: 'complete', summary: 'happy path' },
    }],
  }));
  assert.match(html, /campaign-timeline-item/);
  assert.match(html, /campaign-timeline-dot/);
  assert.match(html, /Resolve/);
  assert.match(html, /campaign-verdict/);
  assert.match(html, /happy path/);
});

test('renderRunsPane: shows finding/artifact/blocked counts + verdict line', () => {
  const P = loadPresenter();
  const html = P.renderRunsPane(fakeReplay({
    runs: [{
      run: { id: 'rrrrrrrr', title: 'r1', status: 'completed' },
      goal: { id: 'g1', title: 'Resolve' },
      findingCount: 1, artifactCount: 2, blockedCount: 0,
      evaluator: { decision: 'complete', summary: 'ok' },
    }],
  }));
  assert.match(html, /campaign-run-row/);
  assert.match(html, /findings: 1/);
  assert.match(html, /artifacts: 2/);
  assert.match(html, /verdict <strong>complete<\/strong>/);
});

test('renderEvidencePane: surfaces the two artifact actions', () => {
  const P = loadPresenter();
  const html = P.renderEvidencePane(fakeReplay());
  assert.match(html, /data-campaign-action="report"/);
  assert.match(html, /data-campaign-action="evidence"/);
});

test('renderActions: produces lifecycle buttons for the matching state', () => {
  const P = loadPresenter();
  // draft → start + cancel
  let html = P.renderActions({ status: 'draft' });
  assert.match(html, /data-campaign-action="start"/);
  assert.match(html, /data-campaign-action="cancel"/);

  // running → pause + run-next + cancel
  html = P.renderActions({ status: 'running' });
  assert.match(html, /data-campaign-action="pause"/);
  assert.match(html, /data-campaign-action="run-next"/);
  assert.doesNotMatch(html, /data-campaign-action="start"/);

  // paused → resume + cancel
  html = P.renderActions({ status: 'paused' });
  assert.match(html, /data-campaign-action="resume"/);

  // completed → no destructive actions
  html = P.renderActions({ status: 'completed' });
  assert.doesNotMatch(html, /data-campaign-action="cancel"/);
});
