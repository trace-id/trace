import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { type EventResponse, type IdentifyResponse } from '@trace-id/signals/api';
import { DEFAULT_FLAGGED_NETWORK_CONFIG } from '@trace-id/signals/config';
import { TEST_SCORING_CONFIG, TEST_USER_AGENT } from '@trace-id/signals/testing';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { generateKey } from '../../src/keys/key-crypto.js';
import { makePayload } from '../payload.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const ORIGIN = 'https://app.example.test';
const hex = (seed: string) => seed.padEnd(28, '0').slice(0, 28);
const NAMES = ['canvas', 'webgl', 'webglParams', 'audio', 'fonts', 'screen', 'hardware', 'timezone', 'languages', 'platform', 'math', 'css', 'media', 'userAgentFamily'];
const device = (seed: string) => Object.fromEntries(NAMES.map((n, i) => [n, hex(`${seed}${i.toString(16)}`)]));

describe.skipIf(!DATABASE_URL)('flaggedNetwork (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  let project: { id: string; pub: string; sec: string };

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    const p = await prisma.project.create({ data: { name: 'network' } });
    const pub = generateKey('public');
    const sec = generateKey('secret');
    await prisma.apiKey.createMany({
      data: [
        { projectId: p.id, type: 'public', prefix: pub.prefix, hash: pub.hash, allowedOrigins: [ORIGIN] },
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
    // The test bots score 60 (webdriver), so flag from 60 here.
    const scoring = { ...TEST_SCORING_CONFIG, flaggedNetwork: { ...DEFAULT_FLAGGED_NETWORK_CONFIG, flagScore: 60 } };
    app = await createApp({ env, scoring, ipIntel: new ListIpIntelProvider(none, none, none) });
    http = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.project.deleteMany({ where: { id: project.id } });
      await prisma.$disconnect();
    }
  });

  const visit = async (seed: string, ip: string, bot = false): Promise<EventResponse> => {
    const res = await http.inject({
      method: 'POST',
      url: `/v1/identify?apiKey=${project.pub}`,
      remoteAddress: ip,
      headers: { 'content-type': 'text/plain', origin: ORIGIN, 'user-agent': TEST_USER_AGENT },
      payload: JSON.stringify({ signals: makePayload({ components: device(seed), bot: { webdriver: bot } }), sdk: { name: 'test', version: '0' } }),
    });
    const { eventId } = res.json<IdentifyResponse>();
    return (await http.inject({ method: 'GET', url: `/v1/events/${eventId}`, headers: { authorization: `Bearer ${project.sec}` } })).json<EventResponse>();
  };

  it('flags a visitor on a network where other visitors were flagged, and not on a clean one', async () => {
    const farm = '198.18.40.';
    const first = await visit('a1', `${farm}10`, true);
    expect(first.signals.flaggedNetwork).toMatchObject({ detected: false, details: { available: true, visitors: 0 } });
    await visit('a2', `${farm}11`, true);
    await visit('a3', `${farm}12`, true);
    const newcomer = await visit('a4', `${farm}13`);
    expect(newcomer.signals.flaggedNetwork).toMatchObject({ detected: true, details: { visitors: 3, flagged: 3 } });
    expect(newcomer.reasons).toContainEqual({ signal: 'flaggedNetwork', contribution: 15 });

    const elsewhere = await visit('b1', '198.18.41.10');
    expect(elsewhere.signals.flaggedNetwork.detected).toBe(false);
  });
});
