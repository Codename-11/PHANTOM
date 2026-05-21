// Chat markdown renderer for the React bundle.
//
// A self-contained port of the load-bearing parts of frontend/js/markdown.js:
// GFM parsing via `marked`, syntax highlighting via `highlight.js`, and XSS
// sanitization via `DOMPurify` (all three already in package.json — no new
// deps). The legacy renderer attached `window.renderMarkdown` + a global
// `copyCode` onclick handler; that DOM-global plumbing does not survive React
// (and breaks under jsdom), so this module exports a pure
// `renderMarkdown(text): string` instead. Code blocks still get a language
// label header, but copy is handled by the browser selection rather than an
// inline onclick (no `onclick` attr means a tighter DOMPurify profile too).

import { marked } from 'marked';
// Slim highlight.js: the full `highlight.js` entry registers ~190 language
// grammars (~340 KB gz) which blew the bundle budget. Import the core +
// only the languages a security-ops chat realistically renders, and drop
// highlightAuto (which needs every grammar registered).
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import http from 'highlight.js/lib/languages/http';
import plaintext from 'highlight.js/lib/languages/plaintext';
import DOMPurify from 'dompurify';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('http', http);
hljs.registerLanguage('plaintext', plaintext);

function escapeHtml(str: string): string {
  return String(str ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

const renderer = new marked.Renderer();

renderer.code = function code(token: unknown): string {
  const t = token as { text?: string; lang?: string };
  const raw = typeof token === 'object' && token !== null ? t.text || '' : String(token);
  const lang = (typeof token === 'object' && token !== null ? t.lang : '') || '';
  const language = lang && hljs.getLanguage(lang) ? lang : null;

  // Only highlight when the fenced language is one we registered; otherwise
  // escape verbatim. We deliberately dropped highlightAuto (it requires the
  // full grammar set) to keep the bundle slim.
  let highlighted: string;
  try {
    highlighted = language
      ? hljs.highlight(raw, { language, ignoreIllegals: true }).value
      : escapeHtml(raw);
  } catch {
    highlighted = escapeHtml(raw);
  }

  const label = language || 'code';
  return (
    `<div class="code-block">` +
    `<div class="code-block-header"><span>${escapeHtml(label)}</span></div>` +
    `<pre><code class="hljs language-${escapeHtml(label)}">${highlighted}</code></pre>` +
    `</div>`
  );
};

// External links open in a new tab — matches legacy behavior.
renderer.link = function link(token: unknown): string {
  const t = token as { href?: string; title?: string; text?: string };
  const safeHref = escapeAttr(t.href || '#');
  const titleAttr = t.title ? ` title="${escapeAttr(t.title)}"` : '';
  return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${titleAttr}>${t.text ?? ''}</a>`;
};

marked.setOptions({ renderer, gfm: true, breaks: false, pedantic: false });

const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel'],
  ALLOW_DATA_ATTR: false,
};

// Renders markdown to a sanitized HTML string. The caller is responsible for
// injecting it via dangerouslySetInnerHTML — the output is DOMPurify-clean.
export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  try {
    const rawHtml = marked.parse(String(text)) as string;
    return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
  } catch {
    return `<pre>${escapeHtml(String(text))}</pre>`;
  }
}
