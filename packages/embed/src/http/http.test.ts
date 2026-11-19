import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage/memory.js';
import { HEADERS, identifyBody, SECRET } from '../test-helpers.js';
import { createTrace } from '../trace.js';
import { type FastifyLike, registerFastify } from './fastify.js';
import { toFetchHandler } from './fetch.js';
import { toNodeHandler } from './node.js';

const make = () => createTrace({ storage: memoryStorage(), secret: SECRET });
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'text/plain', ...HEADERS, 'x-forwarded-for': '198.51.100.4', ...headers }, body: JSON.stringify(body) });

describe('toFetchHandler', () => {
  it('serves identify under the prefix, as a text/plain simple request, and sets the cookie on that path', async () => {
    const handler = toFetchHandler(make());
    const res = await handler(post('https://app.test/trace/v1/identify?apiKey=pk_any', identifyBody('alice')));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { visitorId: string; token: string };
    expect(json.visitorId).toMatch(/^[0-9A-Za-z]{20}$/);
    expect(res.headers.get('set-cookie')).toContain('Path=/trace/v1/identify');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 400 with field paths only, 404 off its paths, 405 for GET, 204 for forget and preflight', async () => {
    const handler = toFetchHandler(make(), { prefix: '/api/trace' });
    const bad = await handler(post('https://app.test/api/trace/v1/identify', { signals: { secret: 'value-not-echoed' } }));
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain('value-not-echoed');
    expect((await handler(post('https://app.test/other', {}))).status).toBe(404);
    expect((await handler(new Request('https://app.test/api/trace/v1/identify'))).status).toBe(405);
    const forget = await handler(post('https://app.test/api/trace/v1/identify/forget', {}));
    expect(forget.status).toBe(204);
    expect(forget.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await handler(new Request('https://app.test/api/trace/v1/identify', { method: 'OPTIONS' }))).status).toBe(204);
  });

  it('uses X-Forwarded-For for the IP by default', async () => {
    const trace = make();
    const handler = toFetchHandler(trace);
    const res = await handler(post('https://app.test/trace/v1/identify', identifyBody('alice')));
    const { eventId } = (await res.json()) as { eventId: string };
    expect((await trace.verify(eventId)).ip.address).toBe('198.51.100.0');
  });
});

describe('toNodeHandler', () => {
  it('works as Express-style middleware on node:http and passes other paths to next()', async () => {
    const mw = toNodeHandler(make());
    const server = createServer((req, res) => {
      void mw(req, res, () => res.writeHead(418).end('next'));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const ok = await fetch(`${base}/trace/v1/identify`, { method: 'POST', headers: { 'content-type': 'text/plain', ...HEADERS }, body: JSON.stringify(identifyBody('alice')) });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { visitorId: string }).visitorId).toMatch(/^[0-9A-Za-z]{20}$/);
      expect((await fetch(`${base}/health`)).status).toBe(418);
      const big = await fetch(`${base}/trace/v1/identify`, { method: 'POST', body: 'x'.repeat(70 * 1024) });
      expect(big.status).toBe(413);
    } finally {
      server.close();
    }
  });
});

describe('registerFastify', () => {
  it('registers both routes and a text/plain parser, and answers through the reply', async () => {
    const routes = new Map<string, (req: unknown, reply: unknown) => Promise<unknown>>();
    let parser = false;
    const app = {
      route: (o: { url: string; handler: (req: unknown, reply: unknown) => Promise<unknown> }) => routes.set(o.url, o.handler),
      addContentTypeParser: () => { parser = true; },
      hasContentTypeParser: () => false,
    };
    registerFastify(app as unknown as FastifyLike, make());
    expect([...routes.keys()]).toEqual(['/trace/v1/identify', '/trace/v1/identify/forget']);
    expect(parser).toBe(true);

    const sent: { status?: number; headers?: Record<string, string>; body?: unknown } = {};
    const reply = {
      code(s: number) { sent.status = s; return reply; },
      headers(h: Record<string, string>) { sent.headers = h; return reply; },
      send(b?: unknown) { sent.body = b; return reply; },
    };
    await routes.get('/trace/v1/identify')!(
      { method: 'POST', url: '/trace/v1/identify?apiKey=pk_x', ip: '203.0.113.9', body: JSON.stringify(identifyBody('alice')), headers: HEADERS },
      reply,
    );
    expect(sent.status).toBe(200);
    expect((sent.body as { visitorId: string }).visitorId).toMatch(/^[0-9A-Za-z]{20}$/);
    expect(sent.headers?.['Set-Cookie']).toContain('Path=/trace/v1/identify');
  });
});
