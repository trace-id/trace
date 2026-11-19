import { makePayload } from '@trace-id/signals/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { IdentifyError } from './errors.js';

const OK_BODY = { eventId: 'e1', visitorId: 'v1', confidence: 0.97, suspectScore: 5, token: 'v1.abc.123.sig' };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function client(extra: Partial<Parameters<typeof createClient>[0]> = {}) {
  return createClient({
    apiKey: 'pk_test',
    endpoint: 'https://id.example.test/',
    collector: () => Promise.resolve(makePayload()),
    ...extra,
  });
}

describe('Client', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects secret keys at construction', () => {
    expect(() => createClient({ apiKey: 'sk_live', endpoint: 'https://x' })).toThrow(IdentifyError);
  });

  it('posts a text/plain simple request and strips the token from the result', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, OK_BODY)));
    vi.stubGlobal('fetch', fetchMock);
    const result = await client().get({ linkedId: 'user-1', tags: { page: 'signup' } });
    expect(result).toEqual({ eventId: 'e1', visitorId: 'v1', confidence: 0.97, suspectScore: 5 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://id.example.test/v1/identify?apiKey=pk_test');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(init.credentials).toBe('omit');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.linkedId).toBe('user-1');
    expect(body.tags).toEqual({ page: 'signup' });
    expect(body.token).toBeUndefined();
    expect(body.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sends credentials in first-party cookie mode, and asks the server to drop the cookie on disable', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, OK_BODY)));
    vi.stubGlobal('fetch', fetchMock);
    const c = client({ firstPartyCookie: true });
    await c.get();
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe('include');
    await c.disable(true);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://id.example.test/v1/identify/forget?apiKey=pk_test');
    expect(init.credentials).toBe('include');
  });

  it('persists the token and sends it next time', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, OK_BODY)));
    vi.stubGlobal('fetch', fetchMock);
    const c = client();
    await c.get();
    await c.get();
    const second = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string) as {
      token?: string;
    };
    expect(second.token).toBe(OK_BODY.token);
  });

  it('does not touch storage when persistToken is false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, OK_BODY))));
    await client({ persistToken: false }).get();
    expect(localStorage.length).toBe(0);
  });

  it('refuses to collect while disabled, and can clear stored data', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, OK_BODY)));
    vi.stubGlobal('fetch', fetchMock);
    const c = client({ enabled: false });
    await expect(c.get()).rejects.toMatchObject({ code: 'collection_disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
    c.enable();
    await c.get();
    expect(localStorage.length).toBe(1);
    await c.disable(true);
    expect(localStorage.length).toBe(0);
  });

  it('maps 429 to rate_limited with Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(jsonResponse(429, { error: { code: 'rate_limited', message: 'slow down' } }, { 'Retry-After': '7' })),
      ),
    );
    await expect(client().get()).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfterSec: 7 });
  });

  it('maps origin rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(403, { error: { code: 'origin_not_allowed', message: 'no' } }))),
    );
    await expect(client().get()).rejects.toMatchObject({ code: 'origin_not_allowed' });
  });

  it('maps network failures and malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(client().get()).rejects.toMatchObject({ code: 'network' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { visitorId: 1 }))));
    await expect(client().get()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('times out instead of hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    await expect(client({ timeoutMs: 50 }).get()).rejects.toMatchObject({ code: 'timeout' });
  });
});
