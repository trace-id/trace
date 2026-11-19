import { makePayload } from '@trace-id/signals/testing';
import { createComponent, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisitorData, IdentifyProvider, useIdentifyClient, type VisitorData } from './index.js';

const OK = { eventId: 'e1', visitorId: 'v1', deviceId: 'v1', confidence: 0.99, suspectScore: 0, token: 'v1.t.1.s' };
const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const options = () => ({ apiKey: 'pk_test', endpoint: 'https://id.example.test', collector: () => Promise.resolve(makePayload()) });
const settle = () => new Promise((r) => setTimeout(r, 10));

/** Renders `use` inside the provider and returns what it produced, plus a dispose function. */
function mount<T>(use: () => T): { value: T; dispose: () => void } {
  let value!: T;
  const dispose = createRoot((d) => {
    createComponent(IdentifyProvider, {
      ...options(),
      get children() {
        value = use();
        return undefined;
      },
    });
    return d;
  });
  return { value, dispose };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('sdk-solid', () => {
  it('getData fills the signals without the token and passes linkedId', async () => {
    const fetchMock = vi.fn(() => respond(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    const m = mount(() => createVisitorData({ immediate: false, linkedId: 'user-1' }));
    expect(m.value.isLoading()).toBe(false);
    const result = await m.value.getData();
    expect(result?.visitorId).toBe('v1');
    expect(m.value.data()).toEqual({ eventId: 'e1', visitorId: 'v1', deviceId: 'v1', confidence: 0.99, suspectScore: 0 });
    expect(m.value.isLoading()).toBe(false);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { linkedId: string };
    expect(body.linkedId).toBe('user-1');
    m.dispose();
  });

  it('identifies on mount by default', async () => {
    const fetchMock = vi.fn(() => respond(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    const m = mount(() => createVisitorData());
    expect(m.value.isLoading()).toBe(true);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(m.value.data()?.eventId).toBe('e1');
    m.dispose();
  });

  it('exposes failures as error() and resolves null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(401, { error: { code: 'invalid_key', message: 'bad' } })));
    const m = mount(() => createVisitorData({ immediate: false }));
    expect(await m.value.getData()).toBeNull();
    expect(m.value.error()).not.toBeNull();
    expect(m.value.data()).toBeNull();
    m.dispose();
  });

  it('shares one client with the subtree and throws a clear error without the provider', () => {
    const m = mount(() => [useIdentifyClient(), useIdentifyClient()] as const);
    expect(m.value[0]).toBe(m.value[1]);
    m.dispose();
    expect(() => createRoot((d) => { try { return useIdentifyClient(); } finally { d(); } })).toThrow(/IdentifyProvider/);
  });

  it('ignores a late result after the component is disposed', async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { release = r; })));
    const m = mount(() => createVisitorData({ immediate: false }) as VisitorData);
    const pending = m.value.getData();
    await settle();
    m.dispose();
    release(new Response(JSON.stringify(OK), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await pending;
    expect(m.value.data()).toBeNull();
  });
});
