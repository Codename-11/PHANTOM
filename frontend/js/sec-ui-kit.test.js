import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

describe('PHANTOM SEC UI kit integration', () => {
  test('replaces decorative hacker chrome with governed operator UI primitives', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /matrix-bg|Matrix Rain|👻|💬|🧾|🕸️|📦|🗂️|⚙️/);
    assert.match(html, /PHANTOM command palette/);
    assert.match(html, /command-palette-trigger/);
    assert.match(html, /Governed AI Security-Ops Cockpit/);
    // Authorized-testing language stays in the input hint
    assert.match(html, /Authorized testing only/);
    // Run config lives in the topbar popover (the new home for scope/toolpacks/override)
    assert.match(html, /run-config-popover/);
    assert.match(html, /data-page="dash"/);
  });

  test('defines cool-slate SEC tokens and command palette styling without restoring green as primary accent', () => {
    const css = read('css/styles.css');
    assert.match(css, /PHANTOM SEC UI kit/);
    // Kit-canonical tokens (authoritative, verbatim from kit/tokens.css)
    assert.match(css, /--bg-0:\s*#0a0c10/);
    assert.match(css, /--cy-1:\s*#5fb6ff/);
    assert.match(css, /--sev-ok:\s*#4ade80/);
    assert.match(css, /--policy:\s*#a78bfa/);
    // Legacy aliases continue to resolve correctly
    assert.match(css, /--bg-primary:\s*var\(--bg-0\)/);
    assert.match(css, /--accent:\s*var\(--cy-1\)/);
    // Command palette markup: both legacy + new kit classes coexist
    assert.match(css, /\.command-palette-panel/);
    assert.match(css, /\.cmdk(?:[^a-z-]|$)/);
    // No regression to the green primary accent that the kit explicitly rejected
    assert.doesNotMatch(css, /--accent:\s*#22c55e/);
    assert.doesNotMatch(css, /--cy-1:\s*#22c55e/);
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
