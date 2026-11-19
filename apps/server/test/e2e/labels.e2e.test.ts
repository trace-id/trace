import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { type EventResponse, type FraudModelsResponse, type IdentifyResponse } from '@trace-id/signals/api';
import { TEST_SCORING_CONFIG, TEST_USER_AGENT } from '@trace-id/signals/testing';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { FraudService } from '../../src/fraud/fraud.service.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { generateKey } from '../../src/keys/key-crypto.js';
import { makePayload } from '../payload.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const ORIGIN = 'https://app.example.test';

type Keys = { id: string; pub: string; sec: string };
const hex = (seed: string) => seed.padEnd(28, '0');
const DEVICE = Object.fromEntries(
  ['canvas', 'webgl', 'webglParams', 'audio', 'fonts', 'screen', 'hardware', 'timezone', 'languages', 'platform', 'math', 'css', 'media', 'userAgentFamily'].map(
    (name, i) => [name, hex(i.toString(16))],
  ),
);

describe.skipIf(!DATABASE_URL)('fraud labels and models (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  const projects: Keys[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    for (const name of ['labels-a', 'labels-b']) {
      const project = await prisma.project.create({ data: { name } });
      const pub = generateKey('public');
      const sec = generateKey('secret');
      await prisma.apiKey.createMany({
        data: [
          { projectId: project.id, type: 'public', prefix: pub.prefix, hash: pub.hash, allowedOrigins: [ORIGIN] },
          { projectId: project.id, type: 'secret', prefix: sec.prefix, hash: sec.hash },
        ],
      });
      projects.push({ id: project.id, pub: pub.key, sec: sec.key });
    }
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL,
      TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
      RATE_LIMIT_INGEST_PER_IP_PER_MIN: '10000',
      RATE_LIMIT_INGEST_PER_VISITOR_PER_MIN: '10000',
    });
    const none = CidrSet.from([]);
    app = await createApp({ env, scoring: TEST_SCORING_CONFIG, ipIntel: new ListIpIntelProvider(none, none, none) });
    http = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
      await prisma.$disconnect();
    }
  });

  const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, key: string, payload?: unknown) =>
    http.inject({ method, url, headers: { authorization: `Bearer ${key}` }, ...(payload ? { payload } : {}) });

  const identify = async (key: string, bot: boolean): Promise<string> => {
    const res = await http.inject({
      method: 'POST',
      url: `/v1/identify?apiKey=${key}`,
      headers: { 'content-type': 'text/plain', origin: ORIGIN, 'user-agent': TEST_USER_AGENT },
      payload: JSON.stringify({ signals: makePayload({ components: DEVICE, bot: { webdriver: bot } }), sdk: { name: 'test', version: '0' } }),
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<IdentifyResponse>().eventId;
  };

  it('validates labels and keeps them inside the project', async () => {
    const [a, b] = projects as [Keys, Keys];
    const eventId = await identify(a.pub, false);
    const url = `/v1/events/${eventId}/labels/payment`;
    expect((await api('PUT', url, a.pub, { fraud: true })).statusCode).toBe(401);
    expect((await api('PUT', url, b.sec, { fraud: true })).statusCode).toBe(404);
    expect((await api('PUT', `/v1/events/${eventId}/labels/Payment`, a.sec, { fraud: true })).statusCode).toBe(400);
    expect((await api('PUT', url, a.sec, { fraud: 'yes' })).statusCode).toBe(400);
    expect((await api('PUT', url, a.sec, { fraud: true, extra: 1 })).statusCode).toBe(400);
    expect((await api('PUT', '/v1/events/not-an-id/labels/payment', a.sec, { fraud: true })).statusCode).toBe(400);

    const ok = await api('PUT', url, a.sec, { fraud: false });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ eventId, label: 'payment', fraud: false });
    expect((await api('DELETE', url, b.sec)).statusCode).toBe(404);
    expect((await api('DELETE', url, a.sec)).statusCode).toBe(204);
    expect((await api('DELETE', url, a.sec)).statusCode).toBe(404);
  });

  it('trains a model per fraud type from labels and scores new events with reasons', async () => {
    const [a] = projects as [Keys];
    // Bots were fraud on this site, clean browsers were not; a second type has too few labels to train.
    for (let i = 0; i < 20; i++) {
      const bot = await identify(a.pub, true);
      const clean = await identify(a.pub, false);
      expect((await api('PUT', `/v1/events/${bot}/labels/payment`, a.sec, { fraud: true })).statusCode).toBe(200);
      expect((await api('PUT', `/v1/events/${clean}/labels/payment`, a.sec, { fraud: false })).statusCode).toBe(200);
      if (i < 3) await api('PUT', `/v1/events/${bot}/labels/promo_abuse`, a.sec, { fraud: true });
    }

    const trained = await api('POST', '/v1/fraud-models/train', a.sec);
    expect(trained.statusCode).toBe(200);
    const body = trained.json<FraudModelsResponse>();
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({ label: 'payment', n: 40, positives: 20 });
    expect(body.models[0]!.coefficients.bot!).toBeGreaterThan(0);
    expect(body.models[0]!.cvAuc).toBe(1);
    expect(body.untrained).toEqual([{ label: 'promo_abuse', n: 3, positives: 3 }]);
    expect((await api('GET', '/v1/fraud-models', a.sec)).json()).toEqual(body);

    const bot = (await api('GET', `/v1/events/${await identify(a.pub, true)}`, a.sec)).json<EventResponse>();
    const clean = (await api('GET', `/v1/events/${await identify(a.pub, false)}`, a.sec)).json<EventResponse>();
    expect(bot.fraudScores).toHaveLength(1);
    expect(bot.fraudScores![0]).toMatchObject({ label: 'payment', reasons: ['bot'] });
    expect(bot.fraudScores![0]!.probability).toBeGreaterThan(0.8);
    expect(clean.fraudScores![0]!.probability).toBeLessThan(0.2);
    expect(clean.fraudScores![0]!.reasons).toEqual([]);
  });

  it("stores the account's history on the event for account-age features", async () => {
    const [a] = projects as [Keys];
    // Distinct networks, so the second browser is not linked to the first as one device.
    const send = async (canvas: string, linkedId: string) => {
      const res = await http.inject({
        method: 'POST',
        remoteAddress: canvas === 'aa' ? '198.51.100.10' : '203.0.113.20',
        url: `/v1/identify?apiKey=${a.pub}`,
        headers: { 'content-type': 'text/plain', origin: ORIGIN, 'user-agent': TEST_USER_AGENT },
        payload: JSON.stringify({ signals: makePayload({ components: Object.fromEntries(Object.keys(DEVICE).map((k, i) => [k, hex(`${canvas}${i.toString(16)}`)])) }), sdk: { name: 'test', version: '0' }, linkedId }),
      });
      const row = await prisma.event.findFirstOrThrow({ where: { id: res.json<IdentifyResponse>().eventId } });
      return (row.signals as { account?: { firstSeenAt: string | null; seenOnDevice: boolean } }).account;
    };
    expect(await send('aa', 'acct-1')).toEqual({ firstSeenAt: null, seenOnDevice: false });
    const again = await send('aa', 'acct-1');
    expect(again).toMatchObject({ seenOnDevice: true });
    expect(await send('bb', 'acct-1')).toEqual({ firstSeenAt: again?.firstSeenAt, seenOnDevice: false });
  });

  it('retrains only what changed and drops models whose labels are gone', async () => {
    const [a, b] = projects as [Keys, Keys];
    const fraud = app.get(FraudService);
    expect((await api('GET', '/v1/fraud-models', b.sec)).json()).toEqual({ models: [], untrained: [] });
    expect(await fraud.trainStale()).toEqual({ trained: 0 });

    await prisma.eventLabel.deleteMany({ where: { projectId: a.id, label: 'payment' } });
    await fraud.trainStale();
    expect((await api('GET', '/v1/fraud-models', a.sec)).json<FraudModelsResponse>().models).toEqual([]);
  });
});
