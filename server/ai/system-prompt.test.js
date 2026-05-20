import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './system-prompt.js';
import { initDB, closeDB } from '../memory/store.js';
import { createGoal, activateGoal, logProgress, clearCurrentGoal } from '../goals/goal-store.js';

test('system prompt always renders without uiContext', () => {
  const prompt = buildSystemPrompt({ raw: true });
  assert.ok(prompt.length > 200, 'prompt has body');
  assert.match(prompt, /You are PHANTOM/);
  assert.match(prompt, /ASK-GATED ACTIONS/);
});

test('installed sec-ops tools block is omitted when nothing on host matches the catalog', () => {
  // On a typical CI/dev box no Kali/red-team tools are on PATH. The block
  // should be absent rather than empty-headered. (If your dev box happens
  // to have nmap installed, the block will appear — both shapes are
  // acceptable, so we assert one of them.)
  const prompt = buildSystemPrompt({ raw: true });
  const hasBlock = /INSTALLED SEC-OPS TOOLS ON HOST/.test(prompt);
  if (hasBlock) {
    // If present, must be well-formed — one of the three tier lines.
    assert.match(prompt, /Base \(recon\/OSINT\)|Offensive \(red\)|Blue \(defense\/DFIR\)/);
    assert.match(prompt, /catalog id|Settings → Tools/);
  } else {
    // If absent (clean dev box), nothing else should look truncated.
    assert.match(prompt, /ASK-GATED ACTIONS/);
  }
});

test('UI context block precedes the sec-ops tools block', () => {
  const prompt = buildSystemPrompt({ raw: true, uiContext: { route: 'chat' } });
  const uiIdx = prompt.indexOf('CURRENT UI CONTEXT');
  const askIdx = prompt.indexOf('ASK-GATED ACTIONS');
  const sosIdx = prompt.indexOf('INSTALLED SEC-OPS TOOLS ON HOST');
  assert.ok(uiIdx > 0, 'UI context block present');
  assert.ok(askIdx > uiIdx, 'ASK-GATED comes after UI context');
  if (sosIdx > 0) {
    assert.ok(sosIdx > uiIdx, 'sec-ops tools block comes after UI context');
    assert.ok(sosIdx < askIdx, 'sec-ops tools block comes before ASK-GATED');
  }
});

test('operator override directive still rides through when uiContext flags it', () => {
  const prompt = buildSystemPrompt({
    raw: true,
    uiContext: { operatorOverride: { enabled: true, reason: 'lab test' } },
  });
  assert.match(prompt, /OPERATOR OVERRIDE/);
  assert.match(prompt, /lab test/);
});

test('CURRENT GOAL block is omitted when no active goal exists', () => {
  initDB(':memory:');
  clearCurrentGoal();
  const prompt = buildSystemPrompt({ raw: true });
  assert.ok(!prompt.includes('CURRENT GOAL'), 'no goal stub should appear when none is active');
  closeDB();
});

test('CURRENT GOAL block renders objective, criteria, progress, and position', () => {
  initDB(':memory:');
  const goal = createGoal({
    title: 'Test goal',
    objective: 'Find any open AdminPortal interfaces.',
    successCriteria: 'A finding exists for every host in the subnet.',
  });
  activateGoal(goal.id);
  logProgress({ goalId: goal.id, note: 'enumerated 10.0.0.0/24', kind: 'step' });

  const prompt = buildSystemPrompt({ raw: true, uiContext: { route: 'chat' } });
  assert.match(prompt, /CURRENT GOAL — Test goal/);
  assert.match(prompt, /Find any open AdminPortal interfaces/);
  assert.match(prompt, /A finding exists for every host/);
  assert.match(prompt, /enumerated 10\.0\.0\.0\/24/);
  assert.match(prompt, /phantom_log_goal_progress/);

  // Goal block lives between UI context and ASK-GATED actions
  const uiIdx = prompt.indexOf('CURRENT UI CONTEXT');
  const goalIdx = prompt.indexOf('CURRENT GOAL');
  const askIdx = prompt.indexOf('ASK-GATED ACTIONS');
  assert.ok(uiIdx < goalIdx, 'goal block follows UI context');
  assert.ok(goalIdx < askIdx, 'goal block precedes ASK-GATED actions');
  closeDB();
});

test('CURRENT GOAL truncates objective beyond ~800 chars', () => {
  initDB(':memory:');
  const huge = 'x'.repeat(2000);
  const g = createGoal({ title: 'big', objective: huge, successCriteria: 'sc' });
  activateGoal(g.id);
  const prompt = buildSystemPrompt({ raw: true });
  // Truncated body ends with ellipsis; we shouldn't see all 2000 x's
  assert.ok(!prompt.includes('x'.repeat(900)), 'objective truncates well under raw length');
  assert.match(prompt, /…/);
  closeDB();
});
