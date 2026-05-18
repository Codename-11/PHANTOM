import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

function loadBuilder() {
  const source = readFileSync(new URL('./scope-builder.js', import.meta.url), 'utf8');
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  new Script(source, { filename: 'scope-builder.js' }).runInContext(sandbox);
  return sandbox.window.ScopeBuilder || sandbox.ScopeBuilder;
}

describe('scope builder UI helpers', () => {
  test('renders editable target chips with risk visibility labels', () => {
    const builder = loadBuilder();
    const html = builder.renderTargetChips([
      { id: 'host:10.0.0.5', type: 'host', value: '10.0.0.5', visibility: 'private' },
      { id: 'url:https://example.com', type: 'url', value: 'https://example.com', visibility: 'public' },
    ]);
    assert.match(html, /target-chip/);
    assert.match(html, /10\.0\.0\.5/);
    assert.match(html, /private/);
    assert.match(html, /data-remove-target/);
  });

  test('renders policy dry-run decisions in operator language', () => {
    const builder = loadBuilder();
    assert.match(builder.renderPolicyPreview({ allowed: true, risk: 'recon', reason: 'Action is inside selected scope', targets: ['example.com'] }), /Allowed/);
    assert.match(builder.renderPolicyPreview({ allowed: false, risk: 'network-scan', reason: 'Target 10.0.0.1 is outside selected scope', targets: ['10.0.0.1'] }), /Blocked/);
  });

  test('converts intent templates into a draft scope policy', () => {
    const builder = loadBuilder();
    const draft = builder.templateToDraft({ id: 'web-recon', name: 'Web Recon', allowedActions: ['recon', 'network-scan'], blockedActions: ['exploit'] });
    assert.strictEqual(draft.nameSuffix, 'Web Recon');
    assert.deepStrictEqual(Array.from(draft.allowedActions), ['recon', 'network-scan']);
    assert.deepStrictEqual(Array.from(draft.blockedActions), ['exploit']);
  });
});
