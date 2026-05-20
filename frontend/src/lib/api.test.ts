// Vitest coverage for the apiFetch wrapper.
//
// We mock global.fetch directly instead of pulling in msw — the wrapper's
// only responsibility is request/response shaping, so a stubbed fetch
// keeps the suite hermetic and ~instant.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch } from './api';

type FetchMock = ReturnType<typeof vi.fn>;

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, value: 42 }));
    const result = await apiFetch<{ ok: boolean; value: number }>('/api/x');
    expect(result).toEqual({ ok: true, value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await apiFetch('/api/x');
    expect(result).toBeNull();
  });

  it('throws ApiError(400) with body.error and retryable=false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'bad input', code: 'BAD_INPUT' }, 400),
    );
    await expect(apiFetch('/api/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'BAD_INPUT',
      message: 'bad input',
      retryable: false,
    });
  });

  it('throws ApiError(500) with retryable=true', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'kaboom' }, 500));
    let caught: ApiError | null = null;
    try {
      await apiFetch('/api/x');
    } catch (err) {
      caught = err as ApiError;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(500);
    expect(caught?.retryable).toBe(true);
  });

  it('throws ApiError(0, TIMEOUT) when the request exceeds timeoutMs', async () => {
    // Simulate a hung fetch by returning a promise that never resolves
    // until the wrapper aborts it. The wrapper's AbortController fires the
    // AbortError, which is what apiFetch translates to a TIMEOUT ApiError.
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const promise = apiFetch('/api/slow', { timeoutMs: 25 });
    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code: 'TIMEOUT',
      retryable: true,
    });
  });

  it('attaches Content-Type: application/json when a body is provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiFetch('/api/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });
});
