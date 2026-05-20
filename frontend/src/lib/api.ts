// Typed fetch wrapper for the React bundle.
//
// Ported from frontend/js/lib/fetch-helper.js so the React and vanilla
// bundles share an identical request contract:
//   - 8000ms default timeout (AbortController-backed)
//   - JSON body auto-content-type
//   - 204 → null
//   - non-2xx → ApiError with {status, code, retryable, message}
//   - timeouts/network errors → ApiError(status=0, code=TIMEOUT|NETWORK)
//
// The legacy helper attaches to window.apiFetch; this module is consumed
// via import so it stays tree-shakeable and typed.

export interface ApiErrorInit {
  status: number;
  message?: string;
  code?: string | null;
  retryable?: boolean;
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  retryable: boolean;

  constructor({ status, message, code = null, retryable = true }: ApiErrorInit) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

// Generic fetch wrapper. The caller picks the response shape via the type
// parameter; null is returned for HTTP 204. Non-JSON responses come back as
// the raw text body so debug surfaces still get something useful.
export async function apiFetch<T = unknown>(
  url: string,
  opts: ApiFetchOptions = {},
): Promise<T | null> {
  const { timeoutMs = 8000, signal: callerSignal, ...rest } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose caller-provided AbortSignal with the timeout controller so
  // either source can cancel the request without leaking listeners.
  let removeCallerAbort: (() => void) | null = null;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      callerSignal.addEventListener('abort', onAbort, { once: true });
      removeCallerAbort = () => callerSignal.removeEventListener('abort', onAbort);
    }
  }

  const headers: HeadersInit = rest.body
    ? { 'Content-Type': 'application/json', ...(rest.headers || {}) }
    : (rest.headers || {});

  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    removeCallerAbort?.();
    const e = err as { name?: string; message?: string };
    if (e?.name === 'AbortError') {
      throw new ApiError({
        status: 0,
        message: `request to ${url} timed out after ${timeoutMs}ms`,
        code: 'TIMEOUT',
        retryable: true,
      });
    }
    throw new ApiError({
      status: 0,
      message: e?.message || 'network error',
      code: 'NETWORK',
      retryable: true,
    });
  }
  clearTimeout(timer);
  removeCallerAbort?.();

  if (res.status === 204) return null;

  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  // .json() on a non-JSON body throws; legacy helper swallowed that to {}.
  // Mirror the same behavior so route handlers that lie about content-type
  // don't crash the page.
  const body: unknown = isJson
    ? await res.json().catch(() => ({}))
    : await res.text();

  if (!res.ok) {
    const bodyObj = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {});
    throw new ApiError({
      status: res.status,
      message: typeof bodyObj.error === 'string' ? (bodyObj.error as string) : `HTTP ${res.status}`,
      code: typeof bodyObj.code === 'string' ? (bodyObj.code as string) : null,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
    });
  }
  return body as T;
}
