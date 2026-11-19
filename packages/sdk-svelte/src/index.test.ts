import { makePayload } from '@trace-id/signals/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisitorData, type VisitorDataState } from './index.js';

const OK = { eventId: 'e1', visitorId: 'v1', deviceId: 'v1', confidence: 0.99, suspectScore: 0, token: 'v1.t.1.s' };
const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const options = { apiKey: 'pk_test', endpoint: 'https://id.example.test', collector: () => Promise.resolve(makePayload()) };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('createVisitorData', () => {
  it('identifies when the first subscriber arrives and publishes the result without the token', async () => {
    const fetchMock = vi.fn(() => respond(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    const store = createVisitorData(options, { linkedId: 'user-1' });
    const states: VisitorDataState[] = [];
    const stop = store.subscribe((s) => states.push(s));
    await tick();
    await tick();
    expect(states[0]).toMatchObject({ isLoading: true, data: null });
    expect(states.at(-1)).toEqual({ isLoading: false, error: null, data: { eventId: 'e1', visitorId: 'v1', deviceId: 'v1', confidence: 0.99, suspectScore: 0 } });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { linkedId: string };
    expect(body.linkedId).toBe('user-1');
    store.subscribe(() => undefined)();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('waits for getData() when immediate is false, and reports typed errors', async () => {
    const fetchMock = vi.fn(() => respond(429, { error: { code: 'rate_limited', message: 'slow' } }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createVisitorData(options, { immediate: false });
    let last: VisitorDataState | null = null;
    store.subscribe((s) => (last = s));
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.getData()).toBeNull();
    expect(last).toMatchObject({ isLoading: false, data: null, error: { code: 'rate_limited' } });
  });

  it('exposes the client for consent', async () => {
    const store = createVisitorData({ ...options, enabled: false }, { immediate: false });
    expect(store.client.isEnabled).toBe(false);
    store.client.enable();
    expect(store.client.isEnabled).toBe(true);
  });
});
