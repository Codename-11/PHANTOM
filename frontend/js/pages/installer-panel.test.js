// Render tests for installer-panel — focused on the per-step status
// rendering since that's where the privilege-failure handling lives and
// where regressions would be silent (the rest of the panel is largely
// boilerplate fetch+inject).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createDomStub, loadFrontendModule } from '../test-dom-stub.js';

const MODULE_PATH = fileURLToPath(new URL('./installer-panel.js', import.meta.url));

function loadPanel() {
  const stub = createDomStub();
  const panel = loadFrontendModule(MODULE_PATH, stub, 'InstallerPanel');
  return { stub, panel };
}

test('InstallerPanel attaches to window with the expected surface', () => {
  const { panel } = loadPanel();
  assert.ok(panel, 'window.InstallerPanel exists');
  assert.equal(typeof panel.load, 'function');
  assert.equal(typeof panel.renderStepStatus, 'function');
  assert.equal(typeof panel.renderRequest, 'function');
  assert.equal(typeof panel.renderToolRow, 'function');
});

test('renderStepStatus renders "needs admin" + copy button for privilege failures', () => {
  const { panel } = loadPanel();
  const html = panel.renderStepStatus({
    exit: 1,
    classification: { kind: 'admin' },
    elevatedCommand: 'sudo apt-get install -y nmap',
  }, { backend: 'apt' });
  assert.match(html, /needs admin/i);
  assert.match(html, /installer-step-copy/);
  assert.match(html, /data-installer-copy="sudo apt-get install -y nmap"/);
});

test('renderStepStatus renders ok pill for exit 0', () => {
  const { panel } = loadPanel();
  const html = panel.renderStepStatus({ exit: 0, classification: { kind: 'ok' } }, { backend: 'apt' });
  assert.match(html, /exit-ok/);
  assert.match(html, /exit 0/);
});

test('renderStepStatus renders timed-out pill', () => {
  const { panel } = loadPanel();
  const html = panel.renderStepStatus({ exit: 124, classification: { kind: 'timeout' } }, { backend: 'apt' });
  assert.match(html, /timed out/);
});

test('renderStepStatus renders skipped reason when no backend resolved', () => {
  const { panel } = loadPanel();
  const html = panel.renderStepStatus(null, { backend: null, reason: 'no package available for win32' });
  assert.match(html, /skipped · no package available/);
});

test('renderStepStatus shows queued state for pending steps with a backend', () => {
  const { panel } = loadPanel();
  const html = panel.renderStepStatus(null, { backend: 'choco' });
  assert.match(html, /queued/);
});

test('renderStepStatus falls back to "exit N" for unclassified failures', () => {
  const { panel } = loadPanel();
  const html = panel.renderStepStatus({ exit: 100, classification: { kind: 'failed' } }, { backend: 'apt' });
  assert.match(html, /exit-fail/);
  assert.match(html, /exit 100/);
});

test('renderRequest renders a card with status, count, and plan table', () => {
  const { panel } = loadPanel();
  const html = panel.renderRequest({
    id: 'req-12345678',
    status: 'pending',
    toolIds: ['nmap', 'ffuf'],
    plan: [
      { id: 'nmap', backend: 'apt', command: 'sudo', args: ['apt-get', 'install', '-y', 'nmap'] },
      { id: 'ffuf', backend: null, reason: 'no package available' },
    ],
    result: null,
  });
  assert.match(html, /status-pending/);
  assert.match(html, /2 tools · 1 installable · 1 skipped/);
  assert.match(html, /req-1234/, 'short id shown');
  assert.match(html, /apt-get install -y nmap/);
  // Pending requests show approve + cancel buttons.
  assert.match(html, /data-req-approve="req-12345678"/);
  assert.match(html, /data-req-cancel="req-12345678"/);
});

test('renderRequest hides approve/cancel buttons for terminal-status requests', () => {
  const { panel } = loadPanel();
  const html = panel.renderRequest({
    id: 'req-completed',
    status: 'completed',
    toolIds: ['nmap'],
    plan: [{ id: 'nmap', backend: 'apt', command: 'sudo', args: ['apt-get', 'install', '-y', 'nmap'] }],
    result: { steps: [{ id: 'nmap', backend: 'apt', exit: 0, classification: { kind: 'ok' } }] },
  });
  assert.match(html, /status-completed/);
  assert.ok(!html.includes('data-req-approve'), 'completed requests are not approvable');
  assert.ok(!html.includes('data-req-cancel'), 'completed requests are not cancellable');
  // Result column carries the ok pill.
  assert.match(html, /exit-ok/);
});

test('renderToolRow marks installed vs missing tools with the correct dot class', () => {
  const { panel } = loadPanel();
  const installed = panel.renderToolRow({ command: 'nmap', summary: 'port scanner', docs: 'https://nmap.org/', available: true });
  const missing   = panel.renderToolRow({ command: 'msfconsole', summary: 'exploit framework', docs: 'https://metasploit.com/', available: false });
  assert.match(installed, /is-ok/);
  assert.match(missing, /is-missing/);
  assert.match(installed, /nmap/);
  assert.match(missing, /msfconsole/);
});

test('resultBlurb summarizes step outcomes for the toast', () => {
  const { panel } = loadPanel();
  const blurb = panel.resultBlurb({
    result: { steps: [
      { exit: 0, classification: { kind: 'ok' } },
      { exit: 0, classification: { kind: 'ok' } },
      { exit: 1, classification: { kind: 'admin' } },
      { skipped: true, classification: { kind: 'skipped' } },
    ]},
  });
  assert.equal(blurb, '2 ok · 1 failed · 1 skipped.');
});
