import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

function loadPresenter() {
  const source = readFileSync(new URL('./graph-presenter.js', import.meta.url), 'utf8');
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  new Script(source, { filename: 'graph-presenter.js' }).runInContext(sandbox);
  return sandbox.window.GraphPresenter || sandbox.GraphPresenter;
}

describe('Graph presentation helpers', () => {
  test('humanizes tool names and edge explanations for operator-readable graph labels', () => {
    const presenter = loadPresenter();

    assert.strictEqual(presenter.formatToolName('execute_command'), 'Shell command');
    assert.strictEqual(presenter.formatToolName('show_preview_window'), 'Preview window');
    assert.strictEqual(presenter.edgeExplanation({ type: 'blocked_by_policy', label: 'blocked command' }), 'Blocked by policy');
    assert.strictEqual(presenter.edgeExplanation({ type: 'observed', label: 'observed' }), 'Observed target');
  });

  test('wrapNodeLabel preserves long titles as two readable lines plus full title', () => {
    const presenter = loadPresenter();
    const wrapped = presenter.wrapNodeLabel('Run a very long governed reconnaissance command against the staging portal', { maxLineLength: 24, maxLines: 2 });

    assert.deepStrictEqual(wrapped.lines.length, 2);
    assert.ok(wrapped.lines[0].length <= 24, wrapped.lines[0]);
    assert.ok(wrapped.lines[1].endsWith('…'), wrapped.lines[1]);
    assert.strictEqual(wrapped.title, 'Run a very long governed reconnaissance command against the staging portal');
  });

  test('summarizeMetadata returns readable rows and redacts sensitive keys', () => {
    const presenter = loadPresenter();
    const rows = presenter.summarizeMetadata({
      eventId: 'evt-1',
      toolCallId: 'call-1',
      outputPreview: 'HTTP 200 OK',
      apiToken: 'secret-token',
      policy: { allowed: false, reason: 'outside scope' },
    });

    assert.ok(rows.some(row => row.label === 'Event' && row.value === 'evt-1'));
    assert.ok(rows.some(row => row.label === 'Tool call' && row.value === 'call-1'));
    assert.ok(rows.some(row => row.label === 'Policy' && /outside scope/.test(row.value)));
    assert.ok(!JSON.stringify(rows).includes('secret-token'));
    assert.ok(JSON.stringify(rows).includes('[REDACTED]'));
  });
});
