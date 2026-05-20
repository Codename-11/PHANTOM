// Shared frontend fetch helper.
//
// Every page that talks to /api should use this so failed/hung routes
// surface as visible errors, not blank panels.
//
// Contract:
//   apiFetch(url, opts?) → returns parsed JSON or throws ApiError.
//   ApiError has { status, message, code?, retryable }.
//   Default timeout is 8000ms; opts.timeoutMs overrides.
//
// Also exposes renderLoading/Empty/Error/Retry card builders so every
// page can render consistent placeholders without re-inventing them.

(function () {
  'use strict';

  class ApiError extends Error {
    constructor({ status, message, code, retryable = true }) {
      super(message || `HTTP ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.code = code || null;
      this.retryable = retryable;
    }
  }

  async function apiFetch(url, opts = {}) {
    const { timeoutMs = 8000, ...rest } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = rest.body
      ? { 'Content-Type': 'application/json', ...(rest.headers || {}) }
      : (rest.headers || {});
    let res;
    try {
      res = await fetch(url, { ...rest, headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new ApiError({ status: 0, message: `request to ${url} timed out after ${timeoutMs}ms`, code: 'TIMEOUT', retryable: true });
      }
      throw new ApiError({ status: 0, message: err.message || 'network error', code: 'NETWORK', retryable: true });
    }
    clearTimeout(timer);
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
    if (!res.ok) {
      throw new ApiError({
        status: res.status,
        message: (body && body.error) || `HTTP ${res.status}`,
        code: (body && body.code) || null,
        retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      });
    }
    return body;
  }

  // ── Shared placeholder cards ───────────────────────────────────────────

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderLoading(label = 'Loading…') {
    return `<div class="ds-card ds-loading" role="status"><span class="ds-spinner" aria-hidden="true"></span>${escHtml(label)}</div>`;
  }

  function renderEmpty({ eyebrow, title, body, cta }) {
    return `
      <div class="ds-card ds-empty">
        ${eyebrow ? `<p class="ds-empty-eyebrow">${escHtml(eyebrow)}</p>` : ''}
        ${title ? `<p class="ds-empty-title">${escHtml(title)}</p>` : ''}
        ${body ? `<p class="ds-empty-body">${escHtml(body)}</p>` : ''}
        ${cta ? `<div class="ds-empty-cta">${cta}</div>` : ''}
      </div>
    `;
  }

  function renderError({ err, retryAction, diagnosticsLink = true }) {
    const e = err instanceof ApiError ? err : { message: String(err && err.message || err), retryable: false, status: 0 };
    return `
      <div class="ds-card ds-error" role="alert">
        <p class="ds-error-title">${escHtml('Something went wrong')}</p>
        <p class="ds-error-body">${escHtml(e.message)}${e.status ? ` (HTTP ${e.status})` : ''}</p>
        <div class="ds-error-actions">
          ${e.retryable !== false && retryAction
            ? `<button class="btn ghost sm" data-ds-retry="${escHtml(retryAction)}">Retry</button>`
            : ''}
          ${diagnosticsLink ? `<button class="btn ghost sm" data-route="settings" data-ds-open-diagnostics="1">Open diagnostics</button>` : ''}
        </div>
      </div>
    `;
  }

  window.ApiError = ApiError;
  window.apiFetch = apiFetch;
  window.DataState = { renderLoading, renderEmpty, renderError };
})();
