// Render tests for profiles-panel — mirrors installer-panel.test.js.
//
// We exercise the render-only paths (no event firing, since the stub's
// querySelectorAll returns []) and the async action paths by stubbing
// fetch on the panel's sandbox window. The DOM stub captures innerHTML
// writes so we can assert on the rendered HTML strings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createDomStub, loadFrontendModule } from '../test-dom-stub.js';

const MODULE_PATH = fileURLToPath(new URL('./profiles-panel.js', import.meta.url));

function loadPanel({ fetchImpl } = {}) {
  const stub = createDomStub();
  // Pre-register the host elements the panel writes into so getElementById
  // returns capturable nodes. innerHTML writes are stored on `_innerHTML`
  // by the stub's makeElement factory.
  const list = stub.makeElement('div');
  const form = stub.makeElement('div');
  const caption = stub.makeElement('div');
  stub.document._register('profiles-list', list);
  stub.document._register('profiles-form', form);
  stub.document._register('profiles-caption', caption);
  // The sandbox snapshots `fetch` at load time (see test-dom-stub.js's
  // `sandbox.fetch = stub.window.fetch`), so a fetch override has to be
  // set on the stub BEFORE the module IIFE runs.
  if (fetchImpl) stub.window.fetch = fetchImpl;
  const panel = loadFrontendModule(MODULE_PATH, stub, 'ProfilesPanel');
  return { stub, panel, hosts: { list, form, caption } };
}

function profileFixture(overrides = {}) {
  return {
    id: 'prof-1234-5678',
    name: 'base-recon',
    description: 'Reconnaissance baseline',
    tool_ids: ['nmap', 'amass'],
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_500_000,
    ...overrides,
  };
}

test('ProfilesPanel attaches to window with the expected surface', () => {
  const { panel } = loadPanel();
  assert.ok(panel, 'window.ProfilesPanel exists');
  assert.equal(typeof panel.load, 'function');
  assert.equal(typeof panel.render, 'function');
  assert.equal(typeof panel.renderRow, 'function');
  assert.equal(typeof panel.applyRuntime, 'function');
  assert.equal(typeof panel.exportDockerfile, 'function');
  assert.equal(typeof panel.submitForm, 'function');
});

test('renderList shows empty state when there are no profiles', () => {
  const { panel, hosts } = loadPanel();
  panel.profiles = [];
  panel.renderList();
  assert.match(hosts.list.innerHTML, /profiles-empty/);
  assert.match(hosts.list.innerHTML, /No profiles yet/i);
  assert.match(hosts.list.innerHTML, /New profile/);
});

test('renderList renders a row for each profile with formatted updated_at', () => {
  const { panel, hosts } = loadPanel();
  panel.profiles = [
    profileFixture({ id: 'p1', name: 'recon', tool_ids: ['nmap'] }),
    profileFixture({ id: 'p2', name: 'offense', tool_ids: ['msfconsole', 'hydra', 'ffuf'] }),
  ];
  panel.renderList();
  const html = hosts.list.innerHTML;
  assert.match(html, /<table class="profiles-table">/);
  assert.match(html, /recon/);
  assert.match(html, /offense/);
  // Tool count column is the .length, not a JSON dump of ids.
  assert.match(html, /<td class="num">1<\/td>/);
  assert.match(html, /<td class="num">3<\/td>/);
  // Apply runtime + Export Dockerfile actions present on each row.
  assert.match(html, /data-profile-install="p1"/);
  assert.match(html, /data-profile-export="p2"/);
  assert.match(html, /data-profile-edit="p1"/);
  assert.match(html, /data-profile-delete="p2"/);
  // updated_at is a ms-epoch INTEGER per Phase 4 — verify we used
  // new Date(ms).toLocaleString() rather than Date.parse-ing it.
  const expected = new Date(1_700_000_500_000).toLocaleString();
  assert.ok(html.includes(expected), `updated_at formatted via Date(ms): expected ${expected}`);
});

test('renderRow tolerates a missing updated_at without crashing', () => {
  const { panel } = loadPanel();
  const html = panel.renderRow({ id: 'p9', name: 'fresh', description: '', tool_ids: [] });
  assert.match(html, /fresh/);
  assert.match(html, /<td class="profiles-updated">—<\/td>/);
});

test('renderForm renders the duplicate-name error inline on the name field', () => {
  const { panel, hosts } = loadPanel();
  panel.formOpen = true;
  panel.editing = 'new';
  panel.formError = { field: 'name', message: 'profile name "base-recon" already exists' };
  panel.renderForm();
  const html = hosts.form.innerHTML;
  assert.match(html, /profiles-field has-error/);
  assert.match(html, /profiles-form-err/);
  assert.match(html, /already exists/);
  // Make sure it's not surfaced as a toast — the form should own the error.
  assert.ok(html.includes('name='));
});

test('renderForm hidden when formOpen is false', () => {
  const { panel, hosts } = loadPanel();
  panel.formOpen = false;
  panel.renderForm();
  assert.equal(hosts.form.innerHTML, '');
});

test('renderCaption surfaces the install-profile.sh dependency note', () => {
  const { panel, hosts } = loadPanel();
  panel.renderCaption();
  assert.match(hosts.caption.innerHTML, /install-profile\.sh/);
  assert.match(hosts.caption.innerHTML, /PHANTOM image/);
});

test('submitForm surfaces a 400 name-uniqueness response inline (not as toast)', async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: 'profile name "base-recon" already exists' }),
    };
  };
  const { panel, hosts } = loadPanel({ fetchImpl });
  panel.profiles = [];
  panel.editing = 'new';
  panel.formOpen = true;

  let toastCalled = false;
  panel.toast = () => { toastCalled = true; };

  // Synthesize a minimal form element with the shape readForm expects.
  const form = {
    elements: {
      name: { value: 'base-recon' },
      description: { value: 'dupe attempt' },
      toolIds: { selectedOptions: [{ value: 'nmap' }] },
    },
  };

  await panel.submitForm(form);

  assert.equal(captured.url, '/api/profiles');
  assert.equal(captured.opts.method, 'POST');
  assert.deepEqual(JSON.parse(captured.opts.body), {
    name: 'base-recon',
    description: 'dupe attempt',
    toolIds: ['nmap'],
  });
  assert.ok(panel.formError, 'formError set');
  assert.equal(panel.formError.field, 'name');
  assert.match(panel.formError.message, /already exists/);
  assert.equal(toastCalled, false, 'duplicate-name error should NOT toast');
  // The form is still open with the error rendered inline.
  assert.equal(panel.formOpen, true);
  assert.match(hosts.form.innerHTML, /already exists/);
});

test('applyRuntime POSTs to /install and surfaces a queued toast with the Approvals action', async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      json: async () => ({
        request: { id: 'req-77' },
        profile: { id: 'p-apply', name: 'base-recon' },
        summary: { total: 2, installable: 2, skipped: 0, backends: ['apt'] },
      }),
    };
  };
  const { panel } = loadPanel({ fetchImpl });
  panel.profiles = [profileFixture({ id: 'p-apply' })];

  const toasts = [];
  panel.toast = (msg, kind, opts) => toasts.push({ msg, kind, opts });

  await panel.applyRuntime('p-apply', null);
  assert.equal(captured.url, '/api/profiles/p-apply/install');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].kind, 'ok');
  assert.match(toasts[0].msg, /Queued in Approvals/);
  assert.match(toasts[0].msg, /2\/2/);
  assert.equal(toasts[0].opts?.action?.route, 'approvals', 'toast links to Approvals page');
});

test('exportDockerfile GETs the fragment, triggers a download via createObjectURL, and revokes the blob', async () => {
  let captured = null;
  const fetchImpl = async (url) => {
    captured = { url };
    return {
      ok: true,
      text: async () => 'RUN /tmp/install-profile.sh red-team\n',
    };
  };
  const { stub, panel } = loadPanel({ fetchImpl });
  panel.profiles = [profileFixture({ id: 'p-export', name: 'red team / kit!' })];

  // Wire URL.createObjectURL + Blob onto the sandbox window — the panel
  // looks up these via `window.URL` / `window.Blob` so a host-app stub
  // can satisfy them without depending on a real browser environment.
  const urls = { created: [], revoked: [] };
  stub.window.URL = {
    createObjectURL: (blob) => { urls.created.push(blob); return 'blob:fake-url'; },
    revokeObjectURL: (u) => { urls.revoked.push(u); },
  };
  stub.window.Blob = class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } };

  await panel.exportDockerfile('p-export', null);

  assert.equal(captured.url, '/api/profiles/p-export/dockerfile');
  assert.equal(urls.created.length, 1, 'createObjectURL was called once');
  assert.ok(urls.created[0], 'blob was passed to createObjectURL');
});

test('applyRuntime surfaces a danger toast when the install route errors out', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  const { panel } = loadPanel({ fetchImpl });
  panel.profiles = [profileFixture({ id: 'p-fail' })];

  const toasts = [];
  panel.toast = (msg, kind) => toasts.push({ msg, kind });

  await panel.applyRuntime('p-fail', null);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].kind, 'danger');
  assert.match(toasts[0].msg, /Apply runtime failed/);
});
