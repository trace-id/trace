import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { type EventResponse, type IdentifyResponse } from '@trace-id/signals/api';
import { makePayload as handBuiltPayload, TEST_SCORING_CONFIG, TEST_USER_AGENT } from '@trace-id/signals/testing';
import { makePayload } from '../payload.js';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { uuidv7 } from '../../src/common/ids.js';
import { parseEnv } from '../../src/config/env.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { generateKey } from '../../src/keys/key-crypto.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const ORIGIN = 'https://app.example.test';
const TOR_IP = '192.0.2.66';

const hex = (seed: string) => seed.padEnd(28, '0');
const DEVICE = {
  canvas: hex('c1'),
  webgl: hex('a1'),
  webglParams: hex('b1'),
  audio: hex('d1'),
  fonts: hex('e1'),
  screen: hex('f1'),
  hardware: hex('1a'),
  timezone: hex('2a'),
  languages: hex('3a'),
  platform: hex('4a'),
  math: hex('5a'),
  css: hex('6a'),
  media: hex('7a'),
  userAgentFamily: hex('8a'),
};

describe.skipIf(!DATABASE_URL)('API end to end (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  const projectIds: string[] = [];
  const keys = { pub: '', sec: '', otherSec: '' };

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    const make = async (name: string) => {
      const project = await prisma.project.create({ data: { name } });
      projectIds.push(project.id);
      const pub = generateKey('public');
      const sec = generateKey('secret');
      await prisma.apiKey.createMany({
        data: [
          { projectId: project.id, type: 'public', prefix: pub.prefix, hash: pub.hash, allowedOrigins: [ORIGIN] },
          { projectId: project.id, type: 'secret', prefix: sec.prefix, hash: sec.hash },
        ],
      });
      return { pub: pub.key, sec: sec.key };
    };
    const main = await make('e2e-main');
    const other = await make('e2e-other');
    Object.assign(keys, { pub: main.pub, sec: main.sec, otherSec: other.sec });

    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL_TEST,
      TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
      IP_STORAGE: 'truncated',
    });
    const ipIntel = new ListIpIntelProvider(CidrSet.from([TOR_IP]), CidrSet.from([]), CidrSet.from([]));
    app = await createApp({ env, scoring: TEST_SCORING_CONFIG, ipIntel });
    http = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.$disconnect();
    }
  });

  function identify(
    body: unknown,
    opts: { key?: string; origin?: string | null; ip?: string; contentType?: string; raw?: string; userAgent?: string } = {},
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = {
      'content-type': opts.contentType ?? 'text/plain',
      'user-agent': opts.userAgent ?? TEST_USER_AGENT,
    };
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    return http.inject({
      method: 'POST',
      url: `/v1/identify?apiKey=${encodeURIComponent(opts.key ?? keys.pub)}`,
      headers,
      payload: opts.raw ?? JSON.stringify(body),
      remoteAddress: opts.ip ?? '198.51.100.10',
    });
  }

  const request = (token?: string, components = DEVICE) => ({
    signals: makePayload({ components }),
    sdk: { name: '@trace-id/sdk-js', version: '0.1.0' },
    ...(token ? { token } : {}),
  });

  function verify(eventId: string, key = keys.sec): Promise<LightMyRequestResponse> {
    return http.inject({ method: 'GET', url: `/v1/events/${eventId}`, headers: { authorization: `Bearer ${key}` } });
  }

  it('identifies, then verifies the full event with the secret key', async () => {
    const res = await identify(request());
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const body = res.json<IdentifyResponse>();
    expect(Object.keys(body).sort()).toEqual(['confidence', 'deviceId', 'eventId', 'suspectScore', 'token', 'visitorId']);

    const ev = await verify(body.eventId);
    expect(ev.statusCode).toBe(200);
    const event = ev.json<EventResponse>();
    expect(event).toMatchObject({ eventId: body.eventId, visitorId: body.visitorId, matchKind: 'new', suspectScore: 0 });
    expect(event.ip.address).toBe('198.51.100.0');
    expect(event.signals.bot.detected).toBe(false);
  });

  it('records which client package sent the event, and stays valid for older SDKs without it', async () => {
    const via = { name: '@trace-id/sdk-react', version: '0.1.0' };
    const withVia = (await identify({ ...request(), via })).json<IdentifyResponse>();
    expect((await verify(withVia.eventId)).json<EventResponse>().client).toEqual({ sdk: { name: '@trace-id/sdk-js', version: '0.1.0' }, via });
    const plain = (await identify(request())).json<IdentifyResponse>();
    expect((await verify(plain.eventId)).json<EventResponse>().client).toEqual({ sdk: { name: '@trace-id/sdk-js', version: '0.1.0' } });
  });

  it('matches the same device in a private window (no token) and with its token', async () => {
    const first = (await identify(request(undefined, { ...DEVICE, canvas: hex('c2') }))).json<IdentifyResponse>();
    const incognito = (await identify(request(undefined, { ...DEVICE, canvas: hex('c2') }))).json<IdentifyResponse>();
    expect(incognito.visitorId).toBe(first.visitorId);
    const withToken = (await identify(request(first.token, { ...DEVICE, canvas: hex('c2') }))).json<IdentifyResponse>();
    expect(withToken.visitorId).toBe(first.visitorId);
    expect((await verify(withToken.eventId)).json<EventResponse>().matchKind).toBe('token');
  });

  it('scores Tor and bot traffic and explains why', async () => {
    // A device of its own: reusing the shared test device would match an earlier visitor and, through that visitor's
    // networks, link to the other test visitors (crossBrowser), which is not what this test is about.
    const own = { ...DEVICE, canvas: hex('70'), audio: hex('71'), fonts: hex('72'), webgl: hex('73') };
    const body = {
      ...request(),
      signals: makePayload({ components: own, attributes: { webglRenderer: 'Tor test GPU 9000' }, bot: { webdriver: true } }),
    };
    const res = (await identify(body, { ip: TOR_IP })).json<IdentifyResponse>();
    const event = (await verify(res.eventId)).json<EventResponse>();
    expect(event.suspectScore).toBe(90);
    expect(event.reasons).toEqual([
      { signal: 'bot', contribution: 60 },
      { signal: 'tor', contribution: 30 },
    ]);
  });

  it('flags a captured request sent again (same nonce)', async () => {
    const own = { ...DEVICE, canvas: hex('80'), audio: hex('81'), fonts: hex('82'), webgl: hex('83') };
    const body = { ...request(undefined, own), nonce: 'cd'.repeat(16), sentAt: Date.now() };
    const first = (await verify((await identify(body)).json<IdentifyResponse>().eventId)).json<EventResponse>();
    const replay = (await verify((await identify(body)).json<IdentifyResponse>().eventId)).json<EventResponse>();
    expect(first.signals.replayedRequest).toMatchObject({ detected: false, details: { available: true } });
    expect(replay.signals.replayedRequest.detected).toBe(true);
    expect(replay.reasons).toContainEqual({ signal: 'replayedRequest', contribution: 50 });
  });

  it('rejects disallowed or missing origins, bad keys and secret keys on ingest', async () => {
    const evil = await identify(request(), { origin: 'https://evil.test' });
    expect(evil.statusCode).toBe(403);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect((await identify(request(), { origin: null })).statusCode).toBe(403);
    expect((await identify(request(), { key: 'pk_nope' })).statusCode).toBe(401);
    expect((await identify(request(), { key: keys.sec })).statusCode).toBe(401);
  });

  it('rejects unknown fields, malformed JSON, oversized bodies and wrong content types', async () => {
    const forged = await identify({ ...request(), visitorId: 'forged' });
    expect(forged.statusCode).toBe(400);
    expect(forged.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect((await identify(null, { raw: '{"signals":' })).statusCode).toBe(400);
    const huge = await identify(null, { raw: JSON.stringify({ pad: 'x'.repeat(70_000) }) });
    expect(huge.statusCode).toBe(413);
    expect(huge.json()).toEqual({ error: { code: 'payload_too_large', message: 'Payload too large' } });
    expect((await identify(request(), { contentType: 'application/xml' })).statusCode).toBe(415);
  });

  it('answers preflight only for allowed origins', async () => {
    const ok = await http.inject({
      method: 'OPTIONS',
      url: `/v1/identify?apiKey=${keys.pub}`,
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('scopes events by project and refuses public keys on the API', async () => {
    const { eventId } = (await identify(request())).json<IdentifyResponse>();
    expect((await verify(eventId, keys.otherSec)).statusCode).toBe(404);
    expect((await verify(eventId, keys.pub)).statusCode).toBe(401);
    expect(
      (await http.inject({ method: 'GET', url: `/v1/events/${eventId}`, headers: { authorization: 'Bearer junk' } }))
        .statusCode,
    ).toBe(401);
    expect((await verify('not-a-uuid')).statusCode).toBe(400);
    expect((await verify(uuidv7())).statusCode).toBe(404);
  });

  it('rejects verification after the window (replay)', async () => {
    const { eventId } = (await identify(request())).json<IdentifyResponse>();
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    const projectId = projectIds[0] as string;
    const row = await prisma.event.findFirstOrThrow({ where: { id: eventId, projectId } });
    const staleId = uuidv7(old);
    await prisma.event.create({
      data: { ...row, id: staleId, createdAt: old, reasons: [], signals: row.signals ?? {}, tags: undefined },
    });
    const res = await verify(staleId);
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: { code: 'event_expired' } });
  });

  it('scores the newer client signals, and still accepts payloads without them', async () => {
    const signals = {
      ...makePayload({
        components: DEVICE,
        attributes: { webglRenderer: 'ANGLE (VMware, Inc., VMware SVGA 3D)' },
        privacy: { braveLikely: true },
      }),
      devtools: { likely: true, method: 'widthGap' },
    };
    // Own network: otherwise it links to the identical test device used by earlier tests.
    const res = await identify({ ...request(), signals }, { ip: '198.18.3.1' });
    expect(res.statusCode).toBe(200);
    const event = (await verify(res.json<IdentifyResponse>().eventId)).json<EventResponse>();
    expect(event.reasons.map((r) => r.signal).sort()).toEqual(['devtools', 'privacyBrowser', 'virtualMachine']);
    expect(event.signals.highActivity.detected).toBe(false);

    const legacy = request();
    expect('devtools' in legacy.signals).toBe(false);
    expect((await identify(legacy)).statusCode).toBe(200);
  });

  it('links the same device across browsers on the same network, never across networks', async () => {
    const chromeUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const firefoxUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
    const machine = {
      platform: 'Win32',
      screenWidth: 2560,
      screenHeight: 1440,
      colorDepth: 24,
      hardwareConcurrency: 12,
      maxTouchPoints: 0,
      timezone: 'Europe/Berlin',
      languages: ['de-DE', 'de'],
    };
    const browser = (ua: string, renderer: string, engine: string) => ({
      signals: {
        // Components chosen by hand per browser engine (the point of this test), so not re-derived from attributes.
        ...handBuiltPayload({
          components: { ...DEVICE, canvas: hex(engine), webgl: hex(`${engine}1`), audio: hex(`${engine}2`), fonts: hex('ff') },
          attributes: { ...machine, userAgent: ua, webglRenderer: renderer },
        }),
        device: { voices: hex('aa'), displayPrefs: hex('bb') },
      },
      sdk: { name: '@trace-id/sdk-js', version: '0.1.0' },
    });
    const chrome = browser(chromeUa, 'ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'e7');
    const firefox = browser(firefoxUa, 'ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar', 'e8');

    const first = (await identify(chrome, { ip: '203.0.113.7', userAgent: chromeUa })).json<IdentifyResponse>();
    const second = (await identify(firefox, { ip: '203.0.113.99', userAgent: firefoxUa })).json<IdentifyResponse>();
    expect(second.visitorId).not.toBe(first.visitorId);
    expect(first.deviceId).toBe(first.visitorId);
    expect(second.deviceId).toBe(first.visitorId);
    const event = (await verify(second.eventId)).json<EventResponse>();
    expect(event.linkedVisitors).toHaveLength(1);
    expect(event.linkedVisitors[0]).toMatchObject({ visitorId: first.visitorId, browser: 'chrome', sameNetwork: true });
    expect(event.linkedVisitors[0]!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(event.signals.crossBrowser).toMatchObject({ detected: true, details: { linkedVisitors: 1, browsers: ['chrome'] } });
    expect(event.reasons.map((r) => r.signal)).toContain('crossBrowser');
    expect(event.signals.bot.detected).toBe(false);

    // Same hardware on another network: not linked by default.
    const elsewhere = browser(firefoxUa, 'ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar', 'e9');
    const third = (await identify(elsewhere, { ip: '192.0.2.200', userAgent: firefoxUa })).json<IdentifyResponse>();
    const thirdEvent = (await verify(third.eventId)).json<EventResponse>();
    expect(thirdEvent.linkedVisitors).toEqual([]);
    expect(thirdEvent.deviceId).toBe(third.visitorId);
    expect(event.deviceId).toBe(first.visitorId);

    // The first browser keeps the shared id when it comes back.
    const again = (await identify({ ...chrome, token: first.token }, { ip: '203.0.113.8', userAgent: chromeUa })).json<IdentifyResponse>();
    expect(again).toMatchObject({ visitorId: first.visitorId, deviceId: first.visitorId });
  });

  it('stores instants correctly whatever the database TimeZone is', async () => {
    const { eventId } = (await identify(request())).json<IdentifyResponse>();
    const [row] = await prisma.$queryRaw<{ skew: number; tz: string }[]>`
      SELECT EXTRACT(EPOCH FROM (now() - "createdAt"))::float AS skew, current_setting('TimeZone') AS tz
      FROM "events" WHERE "id" = ${eventId}::uuid`;
    expect(Math.abs(row?.skew ?? Infinity)).toBeLessThan(60);
  });

  it('serves the browser SDK bundle as cacheable public code, from an allow-list only', async () => {
    const res = await http.inject({ method: 'GET', url: '/sdk/sdk.esm.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body).toContain('createClient');
    for (const url of ['/sdk/package.json', '/sdk/..%2Fpackage.json', '/sdk/client.js']) {
      expect((await http.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('serves health without auth and 404s unknown routes in the standard shape', async () => {
    expect((await http.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    const missing = await http.inject({ method: 'GET', url: '/v1/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
