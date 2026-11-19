import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEdgeProxy } from './index.js';
import { fastlyProxy } from './fastly.js';
import { netlifyProxy } from './netlify.js';
import { vercelProxy } from './vercel.js';

afterEach(() => vi.unstubAllGlobals());

function upstream(response: () => Response = () => new Response('{}')) {
  const seen: { url: string; headers: Headers; method?: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init.headers), method: init.method });
    return response();
  }));
  return seen;
}

const forged = { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6', 'x-ja4': 'forged', 'true-client-ip': '6.6.6.6' };

describe('createEdgeProxy', () => {
  it('strips spoofable headers and refuses paths outside the prefix', async () => {
    const seen = upstream();
    const proxy = createEdgeProxy({ upstream: 'https://up.example/' });
    await proxy(new Request('https://site.example/trace/v1/identify?apiKey=pk_1', { method: 'POST', body: '{}', headers: forged }));
    expect(seen[0]!.url).toBe('https://up.example/v1/identify?apiKey=pk_1');
    for (const h of Object.keys(forged)) expect(seen[0]!.headers.has(h)).toBe(false);
    expect((await proxy(new Request('https://site.example/admin'))).status).toBe(404);
    expect((await proxy(new Request('https://site.example/tracex'))).status).toBe(404);
    expect(seen).toHaveLength(1);
  });

  it('moves the visitor cookie under the prefix', async () => {
    upstream(() => {
      const h = new Headers();
      h.append('set-cookie', '_trace_vt=abc; Path=/v1/identify; HttpOnly; Secure');
      return new Response('{}', { headers: h });
    });
    const res = await createEdgeProxy({ upstream: 'https://up.example', prefix: 'fp' })(new Request('https://site.example/fp/v1/identify', { method: 'POST', body: '{}' }));
    expect(res.headers.getSetCookie()).toEqual(['_trace_vt=abc; Path=/fp/v1/identify; HttpOnly; Secure']);
  });
});

describe('adapters', () => {
  it('netlify uses context.ip, not the visitor header', async () => {
    const seen = upstream();
    await netlifyProxy({ upstream: 'https://up.example' })(new Request('https://s.example/trace/health', { headers: forged }), { ip: '203.0.113.5' });
    expect(seen[0]!.headers.get('x-forwarded-for')).toBe('203.0.113.5');
    expect(seen[0]!.headers.has('x-ja4')).toBe(false);
  });

  it('vercel uses x-real-ip and the JA4 digest', async () => {
    const seen = upstream();
    await vercelProxy({ upstream: 'https://up.example' })(new Request('https://s.example/trace/health', { headers: { 'x-real-ip': '198.51.100.7', 'x-vercel-ja4-digest': 't13d_abc' } }));
    expect(seen[0]!.headers.get('x-forwarded-for')).toBe('198.51.100.7');
    expect(seen[0]!.headers.get('x-ja4')).toBe('t13d_abc');
    expect(seen[0]!.headers.has('x-real-ip')).toBe(false);
  });

  it('fastly uses event.client and responds through the event', async () => {
    const seen = upstream();
    let out: Promise<Response> | undefined;
    fastlyProxy({ upstream: 'https://up.example' })({
      request: new Request('https://s.example/trace/health', { headers: forged }),
      client: { address: '192.0.2.44', tlsJA4: 't13d_fastly' },
      respondWith: (r) => { out = Promise.resolve(r); },
    });
    expect((await out)!.status).toBe(200);
    expect(seen[0]!.headers.get('x-forwarded-for')).toBe('192.0.2.44');
    expect(seen[0]!.headers.get('x-ja4')).toBe('t13d_fastly');
  });
});
