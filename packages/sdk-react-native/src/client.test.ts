// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Client, type ClientDeps } from './client.js';
import { READINGS } from './core.test.js';

const OK = { eventId: '0192f0c4-8a5e-7c3d-9b2a-1f2e3d4c5b6a', visitorId: 'v'.repeat(20), deviceId: 'v'.repeat(20), confidence: 1, suspectScore: 0, token: 'tok-2' };

function setup(response: () => Response = () => new Response(JSON.stringify(OK), { status: 200 })) {
  let stored: string | null = 'tok-1';
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response());
  const deps: ClientDeps = {
    readings: async () => READINGS,
    store: { get: async () => stored, set: async (t) => void (stored = t), clear: async () => void (stored = null) },
    randomBytes: (n) => new Uint8Array(n).fill(7),
    fetch: fetchMock as unknown as typeof fetch,
  };
  return { deps, fetchMock, stored: () => stored };
}

describe('Client', () => {
  it('posts the payload with the app id header, token, nonce and sentAt, and stores the new token', async () => {
    const s = setup();
    const client = new Client({ apiKey: 'pk_test', endpoint: 'https://id.example.com/' }, s.deps);
    const result = await client.get({ linkedId: 'user-1', tags: { screen: 'checkout' } });
    expect(result).toEqual({ eventId: OK.eventId, visitorId: OK.visitorId, deviceId: OK.deviceId, confidence: 1, suspectScore: 0 });
    const [url, init] = s.fetchMock.mock.calls[0]!;
    expect(url).toBe('https://id.example.com/v1/identify?apiKey=pk_test');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain', 'X-Trace-App': 'com.example.shop' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ token: 'tok-1', linkedId: 'user-1', tags: { screen: 'checkout' }, nonce: '07'.repeat(16), sdk: { name: '@trace-id/sdk-react-native' } });
    expect(body.signals.app.platform).toBe('ios');
    expect(typeof body.sentAt).toBe('number');
    expect(s.stored()).toBe('tok-2');
  });

  it('maps server errors and refuses secret keys', async () => {
    const s = setup(() => new Response(JSON.stringify({ error: { code: 'origin_not_allowed', message: 'no' } }), { status: 403 }));
    const client = new Client({ apiKey: 'pk_test', endpoint: 'https://id.example.com' }, s.deps);
    await expect(client.get()).rejects.toMatchObject({ code: 'origin_not_allowed', status: 403 });
    expect(() => new Client({ apiKey: 'sk_live', endpoint: 'https://id.example.com' }, s.deps)).toThrow(/public key/);
  });

  it('stops collecting when disabled, and forgets the token on request', async () => {
    const s = setup();
    const client = new Client({ apiKey: 'pk_test', endpoint: 'https://id.example.com' }, s.deps);
    await client.disable(true);
    await expect(client.get()).rejects.toMatchObject({ code: 'collection_disabled' });
    expect(s.stored()).toBeNull();
    expect(s.fetchMock).not.toHaveBeenCalled();
    client.enable();
    await client.get();
    expect(s.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not read or write the token with persistToken false', async () => {
    const s = setup();
    const client = new Client({ apiKey: 'pk_test', endpoint: 'https://id.example.com', persistToken: false }, s.deps);
    await client.get();
    expect(JSON.parse(s.fetchMock.mock.calls[0]![1].body as string).token).toBeUndefined();
    expect(s.stored()).toBe('tok-1');
  });
});
