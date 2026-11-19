import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { createProxy } from './index.js';

afterEach(() => vi.unstubAllGlobals());

function upstream(response: () => Response) {
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return response();
  }));
  return seen;
}

describe('createProxy', () => {
  it('forwards the path under the prefix with the real client IP and the JA4 fingerprint', async () => {
    const seen = upstream(() => new Response('{}', { status: 200 }));
    const req = new Request('https://www.example.com/trace/v1/identify?apiKey=pk_1', {
      method: 'POST',
      body: '{"a":1}',
      headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6', 'x-ja4': 'forged', origin: 'https://www.example.com' },
    });
    Object.assign(req, { cf: { botManagement: { ja4: 't13d1516h2_8daaf6152771_02713d6af862' } } });
    const res = await createProxy({ upstream: 'https://id-origin.example.com/' })(req);
    expect(res.status).toBe(200);
    expect(seen[0]!.url).toBe('https://id-origin.example.com/v1/identify?apiKey=pk_1');
    const h = new Headers(seen[0]!.init.headers);
    expect(h.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(h.get('x-ja4')).toBe('t13d1516h2_8daaf6152771_02713d6af862');
    expect(h.get('x-forwarded-proto')).toBe('https');
    expect(h.get('origin')).toBe('https://www.example.com');
    expect(seen[0]!.init.method).toBe('POST');
  });

  it('drops a client-sent JA4 header when Cloudflare has none', async () => {
    const seen = upstream(() => new Response('ok'));
    await createProxy({ upstream: 'https://up.example' })(new Request('https://site.example/trace/sdk/sdk.esm.js', { headers: { 'x-ja4': 'forged' } }));
    expect(new Headers(seen[0]!.init.headers).has('x-ja4')).toBe(false);
    expect(seen[0]!.url).toBe('https://up.example/sdk/sdk.esm.js');
  });

  it('moves the visitor cookie under the prefix and keeps other headers', async () => {
    upstream(() => {
      const h = new Headers({ 'content-type': 'application/json', 'access-control-allow-origin': 'https://site.example' });
      h.append('set-cookie', '_trace_vt=abc; Path=/v1/identify; Max-Age=10; HttpOnly; SameSite=Lax; Secure');
      return new Response('{}', { status: 200, headers: h });
    });
    const res = await createProxy({ upstream: 'https://up.example', prefix: 'fp' })(new Request('https://site.example/fp/v1/identify', { method: 'POST', body: '{}' }));
    expect(res.headers.getSetCookie()).toEqual(['_trace_vt=abc; Path=/fp/v1/identify; Max-Age=10; HttpOnly; SameSite=Lax; Secure']);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://site.example');
  });

  it('refuses paths outside the prefix', async () => {
    const seen = upstream(() => new Response('should not be called'));
    const res = await createProxy({ upstream: 'https://up.example' })(new Request('https://site.example/admin'));
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);
    expect((await createProxy({ upstream: 'https://up.example' })(new Request('https://site.example/tracex'))).status).toBe(404);
  });

  it('works as a deployable worker configured by environment variables', async () => {
    const seen = upstream(() => new Response('ok'));
    await worker.fetch(new Request('https://site.example/id/health'), { UPSTREAM: 'https://up.example', PREFIX: '/id' });
    expect(seen[0]!.url).toBe('https://up.example/health');
  });
});
