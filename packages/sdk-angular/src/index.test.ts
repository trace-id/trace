import { createEnvironmentInjector, Injector, runInInjectionContext, type EnvironmentInjector } from '@angular/core';
import { makePayload } from '@trace-id/signals/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectTraceClient, injectVisitorData, provideTrace } from './index.js';

const OK = { eventId: 'e1', visitorId: 'v1', deviceId: 'v1', confidence: 0.99, suspectScore: 0, token: 'v1.t.1.s' };
const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const options = () => ({ apiKey: 'pk_test', endpoint: 'https://id.example.test', collector: () => Promise.resolve(makePayload()) });
const settle = () => new Promise((r) => setTimeout(r, 10));

function ctx() {
  const injector = createEnvironmentInjector([provideTrace(options())], Injector.NULL as EnvironmentInjector);
  return { injector, run: <T>(fn: () => T) => runInInjectionContext(injector, fn) };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('sdk-angular', () => {
  it('getData fills the signals without the token and passes linkedId', async () => {
    const fetchMock = vi.fn(() => respond(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    const { run } = ctx();
    const visitor = run(() => injectVisitorData({ immediate: false, linkedId: 'user-1' }));
    expect(visitor.isLoading()).toBe(false);
    const result = await visitor.getData();
    expect(result?.visitorId).toBe('v1');
    expect(visitor.data()).toEqual({ eventId: 'e1', visitorId: 'v1', deviceId: 'v1', confidence: 0.99, suspectScore: 0 });
    expect(visitor.isLoading()).toBe(false);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { linkedId: string };
    expect(body.linkedId).toBe('user-1');
  });

  it('exposes failures as error() and resolves null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(401, { error: { code: 'invalid_key', message: 'bad' } })));
    const { run } = ctx();
    const visitor = run(() => injectVisitorData({ immediate: false }));
    expect(await visitor.getData()).toBeNull();
    expect(visitor.error()).not.toBeNull();
    expect(visitor.data()).toBeNull();
  });

  it('shares one client and throws a clear error without provideTrace', () => {
    const { run } = ctx();
    expect(run(() => injectTraceClient())).toBe(run(() => injectTraceClient()));
    const bare = createEnvironmentInjector([], Injector.NULL as EnvironmentInjector);
    expect(() => runInInjectionContext(bare, () => injectTraceClient())).toThrow(/provideTrace/);
  });

  it('ignores a late result after destroy', async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { release = r; })));
    const { run, injector } = ctx();
    const visitor = run(() => injectVisitorData({ immediate: false }));
    const pending = visitor.getData();
    await settle();
    injector.destroy();
    release(new Response(JSON.stringify(OK), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await pending;
    expect(visitor.data()).toBeNull();
  });
});
