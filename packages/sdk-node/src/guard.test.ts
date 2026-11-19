import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { traceGuard, type TraceRequest } from './express.js';
import { traceHook } from './fastify.js';
import { guardRequest } from './web.js';

const EVENT_ID = '0192f0c4-8a5e-7c3d-9b2a-1f2e3d4c5b6a';
const EVENT = { eventId: EVENT_ID, visitorId: 'v1', confidence: 0.98, matchKind: 'token', suspectScore: 10, reasons: [], signals: {} };

let status = 200;
let body: unknown = EVENT;
let calls = 0;
let server: Server;
let endpoint: string;
const KEYS = { secretKey: 'sk_test_fake', get endpoint() { return endpoint; } };

beforeAll(async () => {
  server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    calls++;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  status = 200;
  body = EVENT;
  calls = 0;
});

function fakeRes() {
  const out: { status?: number; json?: unknown } = {};
  return { out, res: { status(code: number) { out.status = code; return { json(b: unknown) { out.json = b; } }; } } };
}

describe('express traceGuard', () => {
  it('verifies the header id, sets req.trace and calls next', async () => {
    const req: TraceRequest = { headers: { 'x-trace-event-id': EVENT_ID } };
    const { res, out } = fakeRes();
    let nexted = false;
    await traceGuard({ ...KEYS })(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.trace?.visitorId).toBe('v1');
    expect(out.status).toBeUndefined();
  });

  it('reads the id from the body and rejects with 400 when it is missing', async () => {
    const ok: TraceRequest = { headers: {}, body: { eventId: EVENT_ID } };
    await traceGuard({ ...KEYS })(ok, fakeRes().res, () => undefined);
    expect(ok.trace?.eventId).toBe(EVENT_ID);

    const { res, out } = fakeRes();
    await traceGuard({ ...KEYS })({ headers: {} }, res, () => { throw new Error('must not continue'); });
    expect(out.status).toBe(400);
    expect(calls).toBe(1);
  });

  it('answers 403 when reject() says so, and 400 for an unknown event', async () => {
    const { res, out } = fakeRes();
    await traceGuard({ ...KEYS, reject: (e) => e.suspectScore >= 5 })({ headers: { 'x-trace-event-id': EVENT_ID } }, res, () => undefined);
    expect(out.status).toBe(403);

    status = 404;
    body = { error: { code: 'not_found', message: 'no' } };
    const second = fakeRes();
    await traceGuard({ ...KEYS })({ headers: { 'x-trace-event-id': EVENT_ID } }, second.res, () => undefined);
    expect(second.out.status).toBe(400);
  });

  it('fails closed with 503 by default and open with failOpen; a bad key is always 500', async () => {
    status = 500;
    body = {};
    const closed = fakeRes();
    await traceGuard({ ...KEYS })({ headers: { 'x-trace-event-id': EVENT_ID } }, closed.res, () => undefined);
    expect(closed.out.status).toBe(503);

    const req: TraceRequest = { headers: { 'x-trace-event-id': EVENT_ID } };
    let nexted = false;
    await traceGuard({ ...KEYS, failOpen: true })(req, fakeRes().res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.trace).toBeNull();

    status = 401;
    const bad = fakeRes();
    await traceGuard({ ...KEYS, failOpen: true })({ headers: { 'x-trace-event-id': EVENT_ID } }, bad.res, () => undefined);
    expect(bad.out.status).toBe(500);
  });

  it('answers 500 when no key or endpoint is configured', async () => {
    const { res, out } = fakeRes();
    await traceGuard({})({ headers: { 'x-trace-event-id': EVENT_ID } }, res, () => undefined);
    expect(out.status).toBe(500);
  });
});

describe('fastify traceHook', () => {
  it('sets request.trace and lets the route run; blocks with the guard status otherwise', async () => {
    const app = Fastify();
    app.post('/signup', { preHandler: traceHook({ ...KEYS, reject: (e) => e.visitorId === 'banned' }) }, (req) => ({
      visitor: (req as unknown as { trace: { visitorId: string } }).trace.visitorId,
    }));
    const ok = await app.inject({ method: 'POST', url: '/signup', payload: { eventId: EVENT_ID } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ visitor: 'v1' });

    const missing = await app.inject({ method: 'POST', url: '/signup', payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('event_required');
    await app.close();
  });
});

describe('guardRequest (fetch frameworks)', () => {
  it('returns the event, or a ready Response', async () => {
    const good = await guardRequest(new Request('http://x.test/', { method: 'POST', headers: { 'x-trace-event-id': EVENT_ID } }), { ...KEYS });
    expect(good.event?.visitorId).toBe('v1');

    const fromBody = await guardRequest(
      new Request('http://x.test/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: EVENT_ID }) }),
      { ...KEYS },
    );
    expect(fromBody.event?.eventId).toBe(EVENT_ID);

    const none = await guardRequest(new Request('http://x.test/', { method: 'POST' }), { ...KEYS });
    expect(none.response?.status).toBe(400);
    expect(await none.response?.json()).toEqual({ error: { code: 'event_required', message: 'Missing Trace event id' } });
  });

  it('reads the id from a form post and leaves the body readable', async () => {
    const req = new Request('http://x.test/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=a%40b.test&eventId=${EVENT_ID}` });
    const r = await guardRequest(req, { ...KEYS });
    expect(r.event?.visitorId).toBe('v1');
    expect((await req.formData()).get('email')).toBe('a@b.test');

    const multipart = new FormData();
    multipart.set('eventId', EVENT_ID);
    const m = await guardRequest(new Request('http://x.test/', { method: 'POST', body: multipart }), { ...KEYS });
    expect(m.event?.eventId).toBe(EVENT_ID);

    const none = await guardRequest(new Request('http://x.test/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a%40b.test' }), { ...KEYS });
    expect(none.response?.status).toBe(400);
  });

  it('does not trust a client visitorId: only the verified event is returned', async () => {
    const r = await guardRequest(
      new Request('http://x.test/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: EVENT_ID, visitorId: 'forged' }) }),
      { ...KEYS },
    );
    expect(r.event?.visitorId).toBe('v1');
  });
});
