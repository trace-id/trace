import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyEvent } from './verify.js';

const EVENT_ID = '0192f0c4-8a5e-7c3d-9b2a-1f2e3d4c5b6a';
const EVENT = {
  eventId: EVENT_ID,
  visitorId: 'v1',
  confidence: 0.98,
  matchKind: 'token',
  suspectScore: 0,
  reasons: [],
  signals: {},
};

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler = () => undefined;
let server: Server;
let endpoint: string;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('verifyEvent', () => {
  it('sends the secret key as a bearer token and returns the event', async () => {
    let seen: { url?: string; auth?: string } = {};
    handler = (req, res) => {
      seen = { url: req.url, auth: req.headers.authorization };
      send(res, 200, EVENT);
    };
    await expect(verifyEvent(EVENT_ID, { secretKey: 'sk_x', endpoint: `${endpoint}/` })).resolves.toEqual(EVENT);
    expect(seen).toEqual({ url: `/v1/events/${EVENT_ID}`, auth: 'Bearer sk_x' });
  });

  it('rejects malformed ids and public keys before any request', async () => {
    let called = false;
    handler = (_req, res) => {
      called = true;
      send(res, 200, EVENT);
    };
    await expect(verifyEvent('../../admin', { secretKey: 'sk_x', endpoint })).rejects.toMatchObject({
      code: 'invalid_event_id',
    });
    await expect(verifyEvent(EVENT_ID, { secretKey: 'pk_x', endpoint })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(called).toBe(false);
  });

  it.each([
    [401, 'invalid_key', 'unauthorized'],
    [404, 'not_found', 'not_found'],
    [410, 'event_expired', 'expired'],
    [500, 'internal', 'server_error'],
  ])('maps HTTP %i to %s', async (status, serverCode, code) => {
    handler = (_req, res) => send(res, status, { error: { code: serverCode, message: 'x' } });
    await expect(verifyEvent(EVENT_ID, { secretKey: 'sk_x', endpoint })).rejects.toMatchObject({ code, status });
  });

  it('reports Retry-After on 429', async () => {
    handler = (_req, res) => send(res, 429, { error: { code: 'rate_limited', message: 'x' } }, { 'Retry-After': '3' });
    await expect(verifyEvent(EVENT_ID, { secretKey: 'sk_x', endpoint })).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSec: 3,
    });
  });

  it('times out', async () => {
    handler = () => undefined;
    await expect(verifyEvent(EVENT_ID, { secretKey: 'sk_x', endpoint, timeoutMs: 50 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('rejects a malformed success body', async () => {
    handler = (_req, res) => send(res, 200, { visitorId: 'v1' });
    await expect(verifyEvent(EVENT_ID, { secretKey: 'sk_x', endpoint })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
