import { makePayload } from '@trace-id/signals/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createIdentify, useIdentifyClient, useVisitorData, type VisitorData } from './index.js';

const OK = { eventId: 'e1', visitorId: 'v1', deviceId: 'v1', confidence: 0.99, suspectScore: 0, token: 'v1.t.1.s' };
const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const plugin = () => createIdentify({ apiKey: 'pk_test', endpoint: 'https://id.example.test', collector: () => Promise.resolve(makePayload()) });
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

function mount(options: Parameters<typeof useVisitorData>[0]) {
  let state: VisitorData | null = null;
  const app = createApp(defineComponent({ setup() { state = useVisitorData(options); return () => h('div'); } }));
  app.use(plugin());
  const el = document.createElement('div');
  document.body.appendChild(el);
  app.mount(el);
  return { get state() { return state!; }, unmount: () => app.unmount() };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('sdk-vue', () => {
  it('identifies on mount and exposes reactive state without the token', async () => {
    const fetchMock = vi.fn(() => respond(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    const m = mount({ linkedId: 'user-1' });
    await settle();
    expect(m.state.isLoading.value).toBe(false);
    expect(m.state.data.value).toEqual({ eventId: 'e1', visitorId: 'v1', deviceId: 'v1', confidence: 0.99, suspectScore: 0 });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { linkedId: string };
    expect(body.linkedId).toBe('user-1');
    m.unmount();
  });

  it('waits for getData() when immediate is false, and reports typed errors', async () => {
    const fetchMock = vi.fn(() => respond(429, { error: { code: 'rate_limited', message: 'slow' } }));
    vi.stubGlobal('fetch', fetchMock);
    const m = mount({ immediate: false });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await m.state.getData()).toBeNull();
    expect(m.state.error.value).toMatchObject({ code: 'rate_limited' });
    m.unmount();
  });

  it('requires the plugin', () => {
    const app = createApp(defineComponent({ setup() { useIdentifyClient(); return () => h('div'); } }));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    app.config.errorHandler = (err) => { throw err; };
    expect(() => app.mount(document.createElement('div'))).toThrow(/createIdentify/);
    spy.mockRestore();
  });
});
