import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const read = (path) => readFileSync(resolve(root, path), 'utf8');

describe('PHANTOM SEC UI kit integration', () => {
  test('replaces decorative hacker chrome with governed operator UI primitives', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /matrix-bg|Matrix Rain|👻|💬|🧾|🕸️|📦|🗂️|⚙️/);
    assert.match(html, /PHANTOM command palette/);
    assert.match(html, /command-palette-trigger/);
    assert.match(html, /Governed AI Security-Ops Cockpit/);
    assert.match(html, /Governed tools • Scope gates risky actions/);
    assert.match(html, /Authorized targets only/);
  });

  test('defines cool-slate SEC tokens and command palette styling without restoring green as primary accent', () => {
    const css = read('css/styles.css');
    assert.match(css, /PHANTOM SEC UI kit/);
    assert.match(css, /--bg-primary: #0a0c10/);
    assert.match(css, /--accent: #5fb6ff/);
    assert.match(css, /--success: #4ade80/);
    assert.match(css, /\.command-palette-panel/);
    assert.doesNotMatch(css, /--accent: #22c55e/);
  });

  test('wires Ctrl-K command palette behavior in vanilla JS', () => {
    const js = read('js/app.js');
    assert.match(js, /function initCommandPalette\(\)/);
    assert.match(js, /event\.key\.toLowerCase\(\) === 'k'/);
    assert.match(js, /route: 'scope'/);
    assert.match(js, /route: 'settings'/);
    assert.doesNotMatch(js, /initMatrix\(\);/);
  });
});
