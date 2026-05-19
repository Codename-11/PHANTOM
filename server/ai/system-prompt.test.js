import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './system-prompt.js';

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
