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
  test('renders editable target chips with kind, value, and remove handle', () => {
    // The chip contract is data-driven: each input target produces a
    // <span class="target-chip"> carrying data-target-id, data-kind, and
    // data-value attributes plus a remove button bound by id. The earlier
    // "visibility" label rendering was removed when the policy preview
    // moved to the action-class matrix; this test follows the current
    // contract rather than dead UI.
    const builder = loadBuilder();
    const html = builder.renderTargetChips([
      { id: 'host:10.0.0.5', kind: 'host', value: '10.0.0.5' },
      { id: 'url:https://example.com', kind: 'url', value: 'https://example.com' },
    ]);
    assert.match(html, /target-chip/);
    assert.match(html, /10\.0\.0\.5/);
    assert.match(html, /data-kind="host"/);
    assert.match(html, /data-kind="url"/);
    assert.match(html, /data-remove-target="host:10\.0\.0\.5"/);
    assert.match(html, /data-remove-target="url:https:\/\/example\.com"/);
  });

  test('renderTargetChips returns the empty-state caption when no targets are supplied', () => {
    const builder = loadBuilder();
    const html = builder.renderTargetChips([]);
    assert.match(html, /No targets yet/);
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
