// Evidence redactor — strips secrets from any string/object before it
// becomes an export artifact or leaves the host.
//
// Defense-in-depth: the per-run secret-scrubbing in artifact-store.js
// already runs at write time. This module is the LAST line — it runs
// over the assembled evidence bundle (run records, trace events,
// artifact metadata, prompt snapshots, notes) right before serialization.
//
// What we redact:
//   - OpenAI-style keys (sk-..., sk-proj-...).
//   - Generic bearer tokens (Bearer xxx, Authorization: ...).
//   - AWS-style access keys (AKIA[A-Z0-9]{16}) and secret access keys
//     (40-char base64ish that follow an aws_secret_access_key= pattern).
//   - JWT-shaped strings (three b64 chunks joined by dots).
//   - Common env-style secrets: API_KEY=, SECRET=, TOKEN=, PASSWORD=,
//     SUDO_PASSWORD=.
//   - Long-hex-looking tokens (≥32 hex chars).
//   - Sudo password values exactly when keyed by sudo_password / sudoPassword.
//
// Behavior:
//   - Strings: replaced inline with the same length redaction token
//     (`••••<last4>` when length permits, else `••••`).
//   - Objects: keys matching known-secret names get values replaced
//     entirely (a leaked key NAME without value is still informative).
//   - Arrays: recurse.
//   - Anything else (numbers, bools, null): pass through.
//
// `findLeaks(value)` returns an array of { path, kind, sample } so
// callers can assert in tests that nothing surprising slipped through.

const SECRET_KEY_NAMES = new Set([
  'apikey', 'api_key', 'apiKey',
  'token', 'auth_token', 'access_token', 'refresh_token',
  'secret', 'client_secret', 'aws_secret_access_key',
  'password', 'sudo_password', 'sudoPassword',
  'authorization', 'set-cookie', 'cookie',
  'x-api-key', 'x_api_key',
]);

// Match patterns we want to redact in arbitrary string content.
// `captureIndex` names which capture group (1-based) holds the actual
// secret when the pattern is "keyword + token" style. When undefined,
// the entire match is the secret.
//
// Ordered most-specific → least.
const PATTERNS = [
  { kind: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { kind: 'openai_key',    re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: 'aws_access',    re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'bearer',        re: /\b(?:Bearer|bearer)\s+([A-Za-z0-9_\-.=]{12,})/g,    captureIndex: 1 },
  { kind: 'auth_header',   re: /\b(?:Authorization|authorization)\s*[:=]\s*([A-Za-z0-9_\-.=+/]{12,})/g, captureIndex: 1 },
  { kind: 'jwt',           re: /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'env_secret',    re: /\b(API_KEY|SECRET(?:_KEY)?|TOKEN|PASSWORD|SUDO_PASSWORD)\s*=\s*([^\s'"]+)/gi, captureIndex: 2 },
  { kind: 'long_hex',      re: /\b[a-f0-9]{32,}\b/g },
];

function redactString(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const { re, captureIndex } of PATTERNS) {
    // String.replace with a global regex iterates from the start every
    // call — it does NOT consult re.lastIndex — so the regex object
    // state doesn't leak between calls. We still reset defensively in
    // case exec() ran over the same instance.
    re.lastIndex = 0;
    out = out.replace(re, (match, ...rest) => {
      if (captureIndex != null) {
        // String.replace passes (match, p1, p2, ..., offset, string).
        // captureIndex is 1-based, so the 1-based group is at rest[i-1].
        const captured = rest[captureIndex - 1];
        if (typeof captured === 'string' && captured.length > 0 && captured.length < match.length) {
          // Replace only the captured token, preserve the keyword + spacing.
          const idx = match.lastIndexOf(captured);
          if (idx >= 0) return match.slice(0, idx) + mask(captured) + match.slice(idx + captured.length);
        }
      }
      return mask(match);
    });
  }
  return out;
}

function mask(token) {
  if (typeof token !== 'string') return '••••';
  if (token.length <= 4) return '••••';
  return '••••' + token.slice(-4);
}

function isSecretKey(name) {
  if (!name) return false;
  return SECRET_KEY_NAMES.has(String(name)) ||
         SECRET_KEY_NAMES.has(String(name).toLowerCase());
}

export function redact(value, opts = {}) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, opts));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSecretKey(k) && typeof v === 'string' && v.length > 0) {
      out[k] = mask(v);
    } else {
      out[k] = redact(v, opts);
    }
  }
  return out;
}

/**
 * Walk the value and return an array of leak locations.
 * Used by tests to assert no raw secrets remain after redact().
 *
 * A match is NOT a leak when its "secret-bearing" segment is already
 * the redaction mask (starts with ••••). This lets findLeaks accept
 * already-redacted strings like `API_KEY=••••0abc` as clean.
 */
export function findLeaks(value, path = '$') {
  const leaks = [];
  function visit(v, p) {
    if (typeof v === 'string') {
      for (const { kind, re, captureIndex } of PATTERNS) {
        re.lastIndex = 0;
        const m = re.exec(v);
        if (!m) continue;
        const segment = captureIndex != null ? m[captureIndex] : m[0];
        if (typeof segment === 'string' && segment.startsWith('••••')) continue;
        leaks.push({ path: p, kind, sample: m[0].slice(0, 24) });
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, `${p}[${i}]`));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (isSecretKey(k) && typeof val === 'string' && !/^••••/.test(val)) {
          leaks.push({ path: `${p}.${k}`, kind: 'secret_key_value', sample: val.slice(0, 24) });
        }
        visit(val, `${p}.${k}`);
      }
    }
  }
  visit(value, path);
  return leaks;
}

export const _internals = { mask, redactString, PATTERNS, SECRET_KEY_NAMES };
