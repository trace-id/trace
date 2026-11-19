import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { labelEvent, unlabelEvent } from './verify.js';

const EVENT_ID = '0192f0c4-8a5e-7c3d-9b2a-1f2e3d4c5b6a';
let handler: (req: IncomingMessage, body: string, res: ServerResponse) => void = () => undefined;
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('labelEvent', () => {
  it('puts the verdict with the secret key and returns it', async () => {
    let seen: Record<string, unknown> = {};
    handler = (req, body, res) => {
      seen = { method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ eventId: EVENT_ID, label: 'payment', fraud: true }));
    };
    await expect(labelEvent(EVENT_ID, 'payment', true, { secretKey: 'sk_x', endpoint })).resolves.toEqual({
      eventId: EVENT_ID,
      label: 'payment',
      fraud: true,
    });
    expect(seen).toEqual({ method: 'PUT', url: `/v1/events/${EVENT_ID}/labels/payment`, auth: 'Bearer sk_x', body: { fraud: true } });
  });

  it('validates before any request and maps server errors', async () => {
    let called = false;
    handler = (_req, _body, res) => {
      called = true;
      res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: 'limit_reached', message: 'max' } }));
    };
    await expect(labelEvent(EVENT_ID, 'Payment', true, { secretKey: 'sk_x', endpoint })).rejects.toMatchObject({ code: 'invalid_label' });
    await expect(labelEvent(EVENT_ID, 'payment', true, { secretKey: 'pk_x', endpoint })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(labelEvent('nope', 'payment', true, { secretKey: 'sk_x', endpoint })).rejects.toMatchObject({ code: 'invalid_event_id' });
    expect(called).toBe(false);
    await expect(labelEvent(EVENT_ID, 'payment', true, { secretKey: 'sk_x', endpoint })).rejects.toMatchObject({ code: 'limit_reached', status: 409 });
  });

  it('removes a label and reports a missing one', async () => {
    handler = (req, _body, res) => {
      res.writeHead(req.url?.endsWith('/payment') ? 204 : 404, { 'Content-Type': 'application/json' });
      res.end(req.url?.endsWith('/payment') ? undefined : JSON.stringify({ error: { code: 'not_found', message: 'Label not found' } }));
    };
    await expect(unlabelEvent(EVENT_ID, 'payment', { secretKey: 'sk_x', endpoint })).resolves.toBeUndefined();
    await expect(unlabelEvent(EVENT_ID, 'promo', { secretKey: 'sk_x', endpoint })).rejects.toMatchObject({ code: 'not_found' });
  });
});
