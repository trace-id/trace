import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { buildPayload, type NativeReadings } from '@trace-id/sdk-react-native/core';
import { type EventResponse, type IdentifyResponse } from '@trace-id/signals/api';
import { TEST_SCORING_CONFIG } from '@trace-id/signals/testing';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { generateKey } from '../../src/keys/key-crypto.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const APP_ID = 'com.example.shop';

const phone = (install: string, extra: Partial<NativeReadings> = {}): NativeReadings => ({
  platform: 'ios',
  osVersion: '18.1',
  manufacturer: 'Apple',
  model: 'iPhone 15',
  screen: { width: 393, height: 852, scale: 3 },
  totalMemoryBytes: 6 * 1024 ** 3,
  timezone: 'Africa/Cairo',
  languages: ['ar-EG', 'en-US'],
  appId: APP_ID,
  appVersion: '2.4.0',
  buildVersion: '240',
  isDevice: true,
  rooted: false,
  installedAt: 1_760_000_000_000,
  installIdHash: install.repeat(64).slice(0, 64),
  ...extra,
});

describe.skipIf(!DATABASE_URL)('React Native apps (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  let project: { id: string; pub: string; sec: string };

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    const p = await prisma.project.create({ data: { name: 'mobile' } });
    const pub = generateKey('public');
    const sec = generateKey('secret');
    await prisma.apiKey.createMany({
      data: [
        { projectId: p.id, type: 'public', prefix: pub.prefix, hash: pub.hash, allowedOrigins: ['https://shop.example.com', `app:${APP_ID}`] },
        { projectId: p.id, type: 'secret', prefix: sec.prefix, hash: sec.hash },
      ],
    });
    project = { id: p.id, pub: pub.key, sec: sec.key };
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL,
      TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
      RATE_LIMIT_INGEST_PER_IP_PER_MIN: '10000',
    });
    const none = CidrSet.from([]);
    app = await createApp({ env, scoring: TEST_SCORING_CONFIG, ipIntel: new ListIpIntelProvider(none, none, none) });
    http = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.project.deleteMany({ where: { id: project.id } });
      await prisma.$disconnect();
    }
  });

  // What @trace-id/sdk-react-native sends: no Origin, the app id in X-Trace-App, the HTTP stack's own user agent.
  const identify = (readings: NativeReadings, opts: { token?: string; appHeader?: string | null; ip?: string } = {}) =>
    http.inject({
      method: 'POST',
      url: `/v1/identify?apiKey=${project.pub}`,
      remoteAddress: opts.ip ?? '198.51.100.70',
      headers: {
        'content-type': 'text/plain',
        'user-agent': 'Shop/240 CFNetwork/1568.100.1 Darwin/24.0.0',
        ...(opts.appHeader === null ? {} : { 'x-trace-app': opts.appHeader ?? APP_ID }),
      },
      payload: JSON.stringify({
        signals: buildPayload(readings, 30),
        sdk: { name: '@trace-id/sdk-react-native', version: '0.1.0' },
        ...(opts.token ? { token: opts.token } : {}),
      }),
    });
  const event = async (id: string) =>
    (await http.inject({ method: 'GET', url: `/v1/events/${id}`, headers: { authorization: `Bearer ${project.sec}` } })).json<EventResponse>();

  it('accepts the app listed on the key, and refuses others or a missing app id', async () => {
    expect((await identify(phone('a'), { appHeader: null })).json()).toMatchObject({ error: { code: 'origin_not_allowed' } });
    expect((await identify(phone('a'), { appHeader: 'com.evil.clone' })).statusCode).toBe(403);
    expect((await identify(phone('a'))).statusCode).toBe(200);
  });

  it('identifies a real phone cleanly and reports the app', async () => {
    const res = (await identify(phone('c'))).json<IdentifyResponse>();
    const e = await event(res.eventId);
    expect(e.suspectScore).toBe(0);
    expect(Object.entries(e.signals).filter(([, s]) => s.detected).map(([id]) => id)).toEqual([]);
    expect(e.signals.tamperedRequest.details.mismatched).toEqual([]);
    expect(e.app).toMatchObject({ platform: 'ios', model: 'iPhone 15', appId: APP_ID, isDevice: true, rooted: false });
    expect(e.signals.emulator).toMatchObject({ detected: false, details: { available: true } });
  });

  it('flags emulators and rooted devices', async () => {
    const emu = await event((await identify(phone('e', { isDevice: false, model: 'sdk_gphone64_x86_64', platform: 'android' }))).json<IdentifyResponse>().eventId);
    expect(emu.reasons).toContainEqual({ signal: 'emulator', contribution: 30 });
    const rooted = await event((await identify(phone('9', { rooted: true, platform: 'android' }))).json<IdentifyResponse>().eventId);
    expect(rooted.reasons).toContainEqual({ signal: 'rootedDevice', contribution: 20 });
  });

  it('recognises a reinstall that lost its token by the install id, and keeps identical phones apart', async () => {
    const first = (await identify(phone('d'))).json<IdentifyResponse>();
    const withToken = (await identify(phone('d'), { token: first.token })).json<IdentifyResponse>();
    expect(withToken.visitorId).toBe(first.visitorId);
    const reinstalled = (await identify(phone('d'))).json<IdentifyResponse>();
    expect(reinstalled.visitorId).toBe(first.visitorId);
    // Same model, same settings, another device: a different visitor.
    const twin = (await identify(phone('f'), { ip: '203.0.113.71' })).json<IdentifyResponse>();
    expect(twin.visitorId).not.toBe(first.visitorId);
  });
});
