import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from './client.js';
import { withTrace } from './server.js';

const EVENT_ID = '0192f0c4-8a5e-7c3d-9b2a-1f2e3d4c5b6a';
const EVENT = { eventId: EVENT_ID, visitorId: 'v1', confidence: 0.98, matchKind: 'token', suspectScore: 0, reasons: [], signals: {} };
const OPTS = { secretKey: 'sk_test_fake', endpoint: 'https://id.example.test' };

afterEach(() => vi.unstubAllGlobals());

describe('withTrace', () => {
  it('runs the handler with the verified event and forwards params', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(EVENT), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
    const route = withTrace(async (_req, { event }, ctx: { params: { id: string } }) => Response.json({ v: event?.visitorId, id: ctx.params.id }), OPTS);
    const res = await route(new Request('http://x.test/', { method: 'POST', headers: { 'x-trace-event-id': EVENT_ID } }), { params: { id: '7' } });
    expect(await res.json()).toEqual({ v: 'v1', id: '7' });
  });

  it('answers 400 without calling the handler when there is no event id', async () => {
    const handler = vi.fn(() => new Response('no'));
    const res = await withTrace(handler, OPTS)(new Request('http://x.test/', { method: 'POST' }));
    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('client entry', () => {
  it('re-exports the React bindings', () => {
    expect(typeof client.IdentifyProvider).toBe('function');
    expect(typeof client.useVisitorData).toBe('function');
  });
});
