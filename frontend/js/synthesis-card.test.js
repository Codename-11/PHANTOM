// Render tests for the synthesis-card frontend module.
//
// Loads the IIFE against a minimal DOM stub, hands it a sample synthesis
// payload, and asserts on the resulting innerHTML. We're NOT testing
// event wiring here — those tests would need a real DOM. We ARE testing:
//   - The data shape lands in the rendered output (posture score, scope
//     name, status pills, every highlight + next-step text).
//   - The "preview" option emits the preview banner.
//   - renderCompactRow is suitable for the trending list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createDomStub, loadFrontendModule } from './test-dom-stub.js';

const MODULE_PATH = fileURLToPath(new URL('./synthesis-card.js', import.meta.url));

function sampleSynthesis(overrides = {}) {
  return {
    v: 1,
    runId: 'run-abc-123',
    title: 'Recon lab.local',
    status: 'completed',
    goal: 'Sweep 10.0.0.0/24 for exposed services.',
    outcome: 'Completed · 5 ok · 1 blocked · posture 72/100 (fair)',
    startedAt: '2026-05-19T12:00:00Z',
    endedAt: '2026-05-19T12:05:00Z',
    durationMs: 5 * 60_000,
    scope: { id: 'sc-1', name: 'Lab Network', status: 'active', expiresAt: null },
    objectives: { stated: 'Sweep 10.0.0.0/24', met: 'partial', signal: '1 action blocked.' },
    activity: {
      events: 24,
      toolCalls: { total: 6, succeeded: 5, failed: 0, blocked: 1 },
      artifacts: 2,
      errors: [],
    },
    risk: { highest: 'medium', distribution: { critical: 0, high: 0, medium: 1, low: 2 }, blockedHighRisk: 0 },
    findings: { total: 3, bySeverity: { critical: 0, high: 1, medium: 1, low: 1 }, new: 3, resolved: 0 },
    posture: { score: 72, delta: 5, components: { coverage: 83, risk: 70, hygiene: 60 }, rating: 'fair' },
    highlights: [
      { kind: 'win',  text: 'Five tool calls completed successfully.' },
      { kind: 'risk', text: 'One action blocked — out-of-scope target.' },
    ],
    nextSteps: [
      { kind: 'rerun',     text: 'Re-run after mitigation to verify fixes hold.', action: 'rerun' },
      { kind: 'remediate', text: 'Triage the high-severity finding.',             action: 'review-findings' },
    ],
    policy: { mode: 'governed', approvals: { granted: 1, denied: 0, allowOnce: 0, override: 0, timeout: 0 } },
    ...overrides,
  };
}

test('SynthesisCard.render emits a card with title, outcome, posture score, and scope', () => {
  const stub = createDomStub();
  const SynthesisCard = loadFrontendModule(MODULE_PATH, stub, 'SynthesisCard');
  assert.ok(SynthesisCard, 'module attaches to window.SynthesisCard');

  const host = stub.makeElement('div');
  SynthesisCard.render(host, sampleSynthesis());

  assert.match(host.innerHTML, /END-OF-RUN SYNTHESIS/);
  assert.match(host.innerHTML, /Recon lab\.local/);
  assert.match(host.innerHTML, /Completed · 5 ok/);
  assert.match(host.innerHTML, /Lab Network/);
  // Posture score number renders inside the donut.
  assert.match(host.innerHTML, /<strong>72<\/strong>/);
  // Rating chip.
  assert.match(host.innerHTML, /is-fair/);
  // Delta with up-arrow.
  assert.match(host.innerHTML, /▲ 5/);
});

test('every highlight + next-step text lands in the rendered HTML', () => {
  const stub = createDomStub();
  const SynthesisCard = loadFrontendModule(MODULE_PATH, stub, 'SynthesisCard');
  const host = stub.makeElement('div');
  const data = sampleSynthesis();

  SynthesisCard.render(host, data);

  for (const h of data.highlights) {
    assert.ok(host.innerHTML.includes(h.text),
      `highlight text "${h.text}" should appear in output`);
  }
  for (const s of data.nextSteps) {
    assert.ok(host.innerHTML.includes(s.text),
      `next-step text "${s.text}" should appear in output`);
    // Action attribute is bound on the button so handler routing works.
    assert.ok(host.innerHTML.includes(`data-synth-action="${s.action}"`),
      `next-step action "${s.action}" should appear as a data attribute`);
  }
});

test('preview option adds the "PREVIEW · sample data" banner', () => {
  const stub = createDomStub();
  const SynthesisCard = loadFrontendModule(MODULE_PATH, stub, 'SynthesisCard');
  const host = stub.makeElement('div');
  SynthesisCard.render(host, sampleSynthesis(), { preview: true });
  assert.match(host.innerHTML, /synth-preview-banner/);
  assert.match(host.innerHTML, /PREVIEW/);
});

test('renders a synth-empty placeholder when synthesis is null', () => {
  const stub = createDomStub();
  const SynthesisCard = loadFrontendModule(MODULE_PATH, stub, 'SynthesisCard');
  const host = stub.makeElement('div');
  SynthesisCard.render(host, null);
  assert.match(host.innerHTML, /Synthesis unavailable/);
});

test('renderCompactRow emits a one-line row suitable for the trending list', () => {
  const stub = createDomStub();
  const SynthesisCard = loadFrontendModule(MODULE_PATH, stub, 'SynthesisCard');
  const html = SynthesisCard.renderCompactRow(sampleSynthesis());
  assert.match(html, /synth-row/);
  assert.match(html, /data-run-id="run-abc-123"/);
  assert.match(html, /is-fair/);
  assert.match(html, /Recon lab\.local/);
  assert.match(html, /72/);
});

test('weak posture rating routes through the correct CSS class', () => {
  const stub = createDomStub();
  const SynthesisCard = loadFrontendModule(MODULE_PATH, stub, 'SynthesisCard');
  const host = stub.makeElement('div');
  SynthesisCard.render(host, sampleSynthesis({
    posture: { score: 30, delta: -10, components: { coverage: 20, risk: 30, hygiene: 40 }, rating: 'weak' },
  }));
  assert.match(host.innerHTML, /is-weak/);
  assert.match(host.innerHTML, /▼ 10/, 'negative delta renders the down-arrow');
});
