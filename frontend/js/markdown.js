// PHANTOM chat markdown pipeline.
//
// Replaces the previous hand-rolled regex renderer with a proper stack:
//   marked        — GFM parser (tables, task lists, autolinks)
//   highlight.js  — syntax highlighting per code block
//   DOMPurify     — XSS sanitization on the final HTML
//
// Vite resolves these from node_modules at dev/build time. This file must be
// loaded as `<script type="module">` (see index.html). It assigns the two
// globals the rest of the app expects:
//
//   window.renderMarkdown(text) → sanitized HTML string
//   window.copyCode(id)         → copy button click handler
//
// The previous renderer wrapped every non-tag line in `<p>` and corrupted
// already-rendered tables/lists/code blocks while streaming. marked handles
// the full GFM grammar incrementally-safe; we just re-render the buffer on
// each chunk like before.

import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/github-dark.css';

// One-time marked configuration. We use a custom renderer for code blocks so
// each fenced block gets a kit-aligned header (language label + Copy button)
// and gets piped through highlight.js for token classes.
const renderer = new marked.Renderer();

renderer.code = function code(token) {
  // marked v12+ passes a token object; older API passed (code, lang, escaped)
  const raw = typeof token === 'object' ? token.text || '' : token;
  const lang = (typeof token === 'object' ? token.lang : arguments[1]) || '';
  const language = lang && hljs.getLanguage(lang) ? lang : null;

  let highlighted;
  try {
    highlighted = language
      ? hljs.highlight(raw, { language, ignoreIllegals: true }).value
      : hljs.highlightAuto(raw).value;
  } catch {
    highlighted = escapeHtml(raw);
  }

  const id = 'cb-' + Math.random().toString(36).slice(2, 8);
  const label = language || 'code';
  return (
    `<div class="code-block">` +
      `<div class="code-block-header">` +
        `<span>${escapeHtml(label)}</span>` +
        `<button class="copy-btn" type="button" onclick="copyCode('${id}')">Copy</button>` +
      `</div>` +
      `<pre id="${id}"><code class="hljs language-${escapeHtml(label)}">${highlighted}</code></pre>` +
    `</div>`
  );
};

// Force external links to open in a new tab — matches the prior behavior.
renderer.link = function link(token) {
  const href = typeof token === 'object' ? token.href : arguments[0];
  const title = typeof token === 'object' ? token.title : arguments[1];
  const text = typeof token === 'object' ? token.text : arguments[2];
  const safeHref = escapeAttr(href || '#');
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
  return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: false,
  pedantic: false,
});

// DOMPurify config: allow our renderer's onclick on copy buttons, plus the
// rel/target attrs on external links. Everything else uses the default
// XSS-safe profile.
const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'onclick'],
  ALLOW_DATA_ATTR: false,
};

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

window.renderMarkdown = function renderMarkdown(text) {
  if (!text) return '';
  try {
    const rawHtml = marked.parse(String(text));
    return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
  } catch (err) {
    console.warn('renderMarkdown failed:', err);
    return `<pre>${escapeHtml(text)}</pre>`;
  }
};

window.copyCode = function copyCode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = el.parentElement?.querySelector('.copy-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('copied');
      }, 1500);
    }
  });
};

// Signal that the markdown pipeline is ready. Chat code is tolerant of late
// readiness (it only calls renderMarkdown on user/network events), but other
// modules can listen if they need a hard barrier.
window.dispatchEvent(new CustomEvent('phantom:markdown-ready'));
