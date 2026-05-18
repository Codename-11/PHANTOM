import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

function loadPresenter() {
  const source = readFileSync(new URL('./settings-page-presenter.js', import.meta.url), 'utf8');
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  new Script(source, { filename: 'settings-page-presenter.js' }).runInContext(sandbox);
  return sandbox.window.SettingsPagePresenter || sandbox.SettingsPagePresenter;
}

describe('settings page presenter', () => {
  test('renders non-empty admin cards for general, behavior, security, tools, and advanced settings', () => {
    const presenter = loadPresenter();
    const toolpacks = [{ id: 'web-recon', name: 'Web Recon', summary: 'HTTP surface mapping', risks: ['recon'], policy: { scopeRequired: true }, tools: [{ name: 'httpx', risk: 'network-scan', installHint: 'go install httpx' }] }];
    const outputs = [
      presenter.renderGeneralOverview({ model: 'grok-4.3', baseUrl: 'http://127.0.0.1:8648/v1', workspace: '/tmp/ws' }),
      presenter.renderBehaviorOverview(),
      presenter.renderSecurityOverview(toolpacks),
      presenter.renderToolpackCards(toolpacks),
      presenter.renderAdvancedOverview(),
    ];
    for (const html of outputs) {
      assert.match(html, /<article|<div|<section/);
      assert.ok(html.replace(/<[^>]+>/g, '').trim().length > 40);
      assert.doesNotMatch(html, /placeholder|intentionally not implemented/i);
    }
    assert.match(outputs[2], /Governed execution/);
    assert.match(outputs[3], /Web Recon/);
  });

  test('renders actionable error when toolpacks cannot load instead of a blank panel', () => {
    const presenter = loadPresenter();
    const html = presenter.renderToolpackError('Timed out loading /api/toolpacks');
    assert.match(html, /Failed to load toolpacks/);
    assert.match(html, /restart/i);
  });
});
