// Minimal DOM stub for rendering tests.
//
// We deliberately don't pull in jsdom/linkedom — both synthesis-card and
// installer-panel use only the tiniest DOM surface (createElement('div')
// inside an escape helper, plus innerHTML assignment on a host element).
// A ~50-line stub keeps tests dependency-free and explicit about what
// they cover: the *output HTML string*, not event binding.
//
// What we stub:
//   - document.createElement(tag) → an element with HTML-escaping
//     textContent setter so the renderers' esc() helpers work.
//   - document.getElementById / document.body.appendChild — minimal
//     no-ops so installer-panel's toast path doesn't throw.
//   - A "host" factory the test passes to render(): captures innerHTML
//     and silently no-ops querySelector* + addEventListener so the
//     bindActions() pass after render() runs without errors.

import { Script, createContext } from 'node:vm';
import { readFileSync } from 'node:fs';

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _innerHTML: '',
    _textContent: '',
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    style: {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    // No-op selector returns empty array; render-output assertions read
    // .innerHTML directly so this is enough.
    querySelector: () => null,
    querySelectorAll: () => [],
    focus() {},
    click() {},
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); },
    get textContent() { return this._textContent; },
    set textContent(v) {
      this._textContent = String(v == null ? '' : v);
      this._innerHTML = htmlEscape(v);
    },
  };
  return el;
}

export function createDomStub() {
  const elementsById = new Map();
  const document = {
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => elementsById.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeElement('body'),
    readyState: 'complete',
  };
  // Bound helper so tests can pre-register named hosts.
  document._register = (id, el) => { elementsById.set(id, el); return el; };

  const window = {
    document,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    fetch: () => Promise.reject(new Error('fetch not wired in stub')),
    Router: { navigate() {}, current: null },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    location: { hash: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };

  return { window, document, makeElement };
}

// Load a frontend IIFE module against a stub DOM and return whatever it
// attached to window.<symbol>. Mirrors the pattern in
// settings-page-presenter.test.js.
export function loadFrontendModule(absolutePath, stub, symbol) {
  const source = readFileSync(absolutePath, 'utf8');
  const sandbox = {
    window: stub.window,
    document: stub.document,
    console,
  };
  // Wire window methods to the sandbox global so `document.createElement`
  // and `setTimeout` lookups inside the IIFE resolve.
  sandbox.document = stub.document;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.fetch = stub.window.fetch;
  sandbox.navigator = stub.window.navigator;
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  new Script(source, { filename: absolutePath }).runInContext(sandbox);
  if (symbol) return stub.window[symbol] || sandbox[symbol] || null;
  return stub.window;
}
