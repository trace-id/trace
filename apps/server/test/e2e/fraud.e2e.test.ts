import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { type DeviceResponse, type EventResponse, type IdentifyResponse } from '@trace-id/signals/api';
// Components here are set by hand to model devices that change; the tamper check is not what these tests are about.
import { makePayload, TEST_SCORING_CONFIG, TEST_USER_AGENT } from '@trace-id/signals/testing';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { MaintenanceService } from '../../src/infra/maintenance.service.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { generateKey } from '../../src/keys/key-crypto.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const ORIGIN = 'https://app.example.test';
const SCRIPT_JA4 = 't13d311000_e8f1e7e78f70_d41ae481755e';

/** A device whose 14 component hashes all start with `seed`. */
function device(seed: string): Record<string, string> {
  const names = ['canvas', 'webgl', 'webglParams', 'audio', 'fonts', 'screen', 'hardware', 'timezone', 'languages',
    'platform', 'math', 'css', 'media', 'userAgentFamily'];
  return Object.fromEntries(names.map((n, i) => [n, `${seed}${i.toString(16)}`.padEnd(28, '0')]));
}

describe.skipIf(!DATABASE_URL)('fraud features end to end (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  let projectId = '';
  const keys = { pub: '', sec: '' };

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    const project = await prisma.project.create({ data: { name: 'e2e-fraud' } });
    projectId = project.id;
    const pub = generateKey('public');
    const sec = generateKey('secret');
    await prisma.apiKey.createMany({
      data: [
        { projectId, type: 'public', prefix: pub.prefix, hash: pub.hash, allowedOrigins: [ORIGIN] },
        { projectId, type: 'secret', prefix: sec.prefix, hash: sec.hash },
      ],
    });
    Object.assign(keys, { pub: pub.key, sec: sec.key });
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL,
      TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
      TLS_FINGERPRINT_HEADER: 'x-ja4',
    });
    const none = CidrSet.from([]);
    app = await createApp({ env, scoring: TEST_SCORING_CONFIG, ipIntel: new ListIpIntelProvider(none, none, none) });
    http = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.$disconnect();
    }
  });

  function identify(
    components: Record<string, string>,
    opts: { ip: string; linkedId?: string; cookie?: string; ja4?: string },
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { 'content-type': 'text/plain', 'user-agent': TEST_USER_AGENT, origin: ORIGIN };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.ja4) headers['x-ja4'] = opts.ja4;
    return http.inject({
      method: 'POST',
      url: `/v1/identify?apiKey=${encodeURIComponent(keys.pub)}`,
      headers,
      payload: JSON.stringify({
        signals: makePayload({ components }),
        sdk: { name: '@trace-id/sdk-js', version: '0.1.0' },
        ...(opts.linkedId ? { linkedId: opts.linkedId } : {}),
      }),
      remoteAddress: opts.ip,
    });
  }

  async function event(res: LightMyRequestResponse): Promise<EventResponse> {
    expect(res.statusCode).toBe(200);
    const { eventId } = res.json<IdentifyResponse>();
    const r = await http.inject({ method: 'GET', url: `/v1/events/${eventId}`, headers: { authorization: `Bearer ${keys.sec}` } });
    expect(r.statusCode).toBe(200);
    return r.json<EventResponse>();
  }

  it('sets a same-site HttpOnly visitor cookie and recognises the visitor by it', async () => {
    const first = await identify(device('c0'), { ip: '198.18.10.1' });
    expect(first.statusCode).toBe(200);
    const setCookie = String(first.headers['set-cookie']);
    expect(setCookie).toMatch(/^_trace_vt=[\w.-]+; Path=\/v1\/identify; Max-Age=\d+; HttpOnly; SameSite=Lax$/);
    expect(first.headers['access-control-allow-credentials']).toBe('true');
    const cookie = setCookie.split(';')[0]!;

    // GPU readings, screen and time zone changed: too different to match on signals alone (the linkage matcher calls
    // it another device), still close enough for the saved token to be trusted (weighted agreement >= 0.6).
    const changed = { ...device('c0'), canvas: 'f'.repeat(28), audio: 'e'.repeat(28), screen: 'd'.repeat(28), timezone: 'c'.repeat(28) };
    const without = await event(await identify(changed, { ip: '198.18.10.1' }));
    expect(without.matchKind).toBe('new');
    const withCookie = await event(await identify(changed, { ip: '198.18.10.1', cookie }));
    expect(withCookie).toMatchObject({ matchKind: 'token', visitorId: first.json<IdentifyResponse>().visitorId });

    const forget = await http.inject({
      method: 'POST',
      url: `/v1/identify/forget?apiKey=${encodeURIComponent(keys.pub)}`,
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
      payload: '{}',
    });
    expect(forget.statusCode).toBe(204);
    expect(String(forget.headers['set-cookie'])).toContain('_trace_vt=; Path=/v1/identify; Max-Age=0');
  });

  it('flags many accounts on one device and lists them in the device graph', async () => {
    const d = device('a1');
    const e1 = await event(await identify(d, { ip: '198.18.11.1', linkedId: 'user-1' }));
    expect(e1.signals.multiAccount.details).toEqual({ available: true, accountsOnDevice: 1, threshold: 2 });
    await identify(d, { ip: '198.18.11.1', linkedId: 'user-2' });
    const e3 = await event(await identify(d, { ip: '198.18.11.1', linkedId: 'user-3' }));
    expect(e3.signals.multiAccount).toMatchObject({ detected: true, details: { accountsOnDevice: 3 } });
    expect(e3.reasons.map((r) => r.signal)).toContain('multiAccount');

    const graph = await http.inject({
      method: 'GET',
      url: `/v1/devices/${e3.deviceId}`,
      headers: { authorization: `Bearer ${keys.sec}` },
    });
    expect(graph.statusCode).toBe(200);
    const body = graph.json<DeviceResponse>();
    expect(body.visitors.map((v) => v.visitorId)).toEqual([e3.visitorId]);
    expect(body.visitors[0]!.browser).toBe('chrome');
    expect(body.accounts.map((a) => a.linkedId).sort()).toEqual(['user-1', 'user-2', 'user-3']);

    const missing = await http.inject({
      method: 'GET',
      url: `/v1/devices/${'Z'.repeat(20)}`,
      headers: { authorization: `Bearer ${keys.sec}` },
    });
    expect(missing.statusCode).toBe(404);
    const noKey = await http.inject({ method: 'GET', url: `/v1/devices/${e3.deviceId}` });
    expect(noKey.statusCode).toBe(401);
  });

  it('flags one account used on many devices', async () => {
    let last: EventResponse | null = null;
    for (let i = 0; i < 6; i++) {
      // Different networks, so the identical test hardware does not merge them into one device.
      last = await event(await identify(device(`b${i}`), { ip: `198.18.${20 + i}.1`, linkedId: 'shared-account' }));
    }
    expect(last!.signals.accountSharing).toMatchObject({ detected: true, details: { devicesForAccount: 6, threshold: 5 } });
  });

  it('rebuilds the value frequencies the linkage matcher reads', async () => {
    await app.get(MaintenanceService).refreshComponentStats();
    const total = await prisma.componentStat.findUnique({
      where: { projectId_component_value: { projectId, component: '_total', value: '_' } },
    });
    const visitors = await prisma.visitor.count({ where: { projectId } });
    expect(total?.visitors).toBe(visitors);
    // Every test device reports the same platform hash prefix family; at least one value is shared by 2+ visitors.
    const shared = await prisma.componentStat.findMany({ where: { projectId, component: { not: '_total' } } });
    expect(shared.every((r) => r.visitors >= 2)).toBe(true);
  });

  it('serves the OpenAPI description without a key', async () => {
    const res = await http.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json<{ openapi: string; paths: Record<string, Record<string, { operationId: string }>> }>();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/v1/identify', '/v1/events/{eventId}', '/v1/visitors/{visitorId}', '/v1/devices/{deviceId}', '/v1/webhooks']),
    );
    const ids = Object.values(spec.paths).flatMap((ops) => Object.values(ops).map((o) => o.operationId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('flags a TLS handshake that does not fit the claimed browser', async () => {
    const bad = await event(await identify(device('d1'), { ip: '198.18.30.1', ja4: SCRIPT_JA4 }));
    expect(bad.signals.tlsMismatch).toEqual({
      detected: true,
      details: { available: true, ja4: SCRIPT_JA4, reasons: ['noAlpn'] },
    });
    const good = await event(await identify(device('d1'), { ip: '198.18.30.1', ja4: 't13d1516h2_8daaf6152771_02713d6af862' }));
    expect(good.signals.tlsMismatch.detected).toBe(false);
    const none = await event(await identify(device('d1'), { ip: '198.18.30.1', ja4: 'garbage' }));
    expect(none.signals.tlsMismatch.details).toEqual({ available: false });
  });
});
