import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { verifyWebhook } from '@tbdname/sdk-node/webhooks';
import { type IdentifyResponse, type WebhookEndpointResponse } from '@tbdname/signals/api';
import { makePayload, TEST_SCORING_CONFIG, TEST_USER_AGENT } from '@tbdname/signals/testing';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { generateKey } from '../../src/keys/key-crypto.js';
import { WebhookWorkerService } from '../../src/webhooks/webhook-worker.service.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const ORIGIN = 'https://app.example.test';

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe.skipIf(!DATABASE_URL)('webhooks (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  let receiver: Server;
  let receiverUrl: string;
  let received: Received[] = [];
  let receiverStatus = 200;
  const projects: { id: string; pub: string; sec: string }[] = [];

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(receiverStatus).end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    for (const name of ['hooks-a', 'hooks-b']) {
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
      WEBHOOK_ALLOW_INSECURE: 'true',
    });
    const none = CidrSet.from([]);
    app = await createApp({ env, scoring: TEST_SCORING_CONFIG, ipIntel: new ListIpIntelProvider(none, none, none) });
    http = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app?.close();
    receiver?.closeAllConnections();
    await new Promise<void>((r) => receiver?.close(() => r()));
    if (prisma) {
      await prisma.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
      await prisma.$disconnect();
    }
  });

  beforeEach(() => {
    received = [];
    receiverStatus = 200;
  });

  const api = (method: 'GET' | 'POST' | 'DELETE', url: string, key: string, payload?: unknown) =>
    http.inject({ method, url, headers: { authorization: `Bearer ${key}` }, ...(payload ? { payload } : {}) });

  const identify = (key: string, bot = false) =>
    http.inject({
      method: 'POST',
      url: `/v1/identify?apiKey=${key}`,
      headers: { 'content-type': 'text/plain', origin: ORIGIN, 'user-agent': TEST_USER_AGENT },
      payload: JSON.stringify({
        signals: makePayload({
          components: { canvas: `${Math.random().toString(16).slice(2)}`.padEnd(28, '0').slice(0, 28) },
          bot: { webdriver: bot },
        }),
        sdk: { name: 'test', version: '0' },
      }),
    });

  it('delivers signed event.created and visitor.flagged webhooks that sdk-node verifies', async () => {
    const [a] = projects as [{ id: string; pub: string; sec: string }];
    const created = await api('POST', '/v1/webhooks', a.sec, {
      url: receiverUrl,
      events: ['event.created', 'visitor.flagged'],
      flagThreshold: 50,
    });
    expect(created.statusCode).toBe(201);
    const endpoint = created.json<WebhookEndpointResponse>();
    expect(endpoint.secret).toMatch(/^whsec_/);

    const list = await api('GET', '/v1/webhooks', a.sec);
    expect(JSON.stringify(list.json())).not.toContain('whsec_');

    const clean = (await identify(a.pub)).json<IdentifyResponse>();
    const flagged = (await identify(a.pub, true)).json<IdentifyResponse>();
    await app.get(WebhookWorkerService).processDue();

    const payloads = received.map((r) =>
      verifyWebhook({ body: r.body, signature: r.headers['x-signature'] as string, secret: endpoint.secret ?? '' }),
    );
    const summary = payloads.map((p) => `${p.type}:${p.data.eventId}`).sort();
    expect(summary).toEqual(
      [`event.created:${clean.eventId}`, `event.created:${flagged.eventId}`, `visitor.flagged:${flagged.eventId}`].sort(),
    );
    expect(payloads.find((p) => p.type === 'visitor.flagged')?.data.reasons[0]?.signal).toBe('bot');
    expect(received.every((r, i) => r.headers['x-webhook-id'] === payloads[i]?.id)).toBe(true);

    expect((await api('DELETE', `/v1/webhooks/${endpoint.id}`, a.sec)).statusCode).toBe(204);
  });

  it('retries failed deliveries with backoff and keeps the same delivery id', async () => {
    const [a] = projects as [{ id: string; pub: string; sec: string }];
    const endpoint = (await api('POST', '/v1/webhooks', a.sec, { url: receiverUrl, events: ['event.created'] })).json<WebhookEndpointResponse>();
    receiverStatus = 503;
    await identify(a.pub);
    const worker = app.get(WebhookWorkerService);
    await worker.processDue();
    expect(received).toHaveLength(1);
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: endpoint.id } });
    expect(delivery).toMatchObject({ status: 'pending', attempts: 1, lastStatus: 503 });
    expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5000);

    await worker.processDue();
    expect(received).toHaveLength(1);

    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { nextAttemptAt: new Date() } });
    receiverStatus = 200;
    await worker.processDue();
    expect(received).toHaveLength(2);
    expect(received[0]?.headers['x-webhook-id']).toBe(received[1]?.headers['x-webhook-id']);
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      status: 'succeeded',
      attempts: 2,
    });
    await api('DELETE', `/v1/webhooks/${endpoint.id}`, a.sec);
  });

  it('validates input, isolates projects and caps endpoints', async () => {
    const [a, b] = projects as [{ id: string; pub: string; sec: string }, { id: string; pub: string; sec: string }];
    expect((await api('POST', '/v1/webhooks', a.sec, { url: receiverUrl, events: ['nope'] })).statusCode).toBe(400);
    expect((await api('POST', '/v1/webhooks', a.sec, { url: receiverUrl, events: ['event.created'], extra: 1 })).statusCode).toBe(400);
    expect((await api('POST', '/v1/webhooks', a.pub, { url: receiverUrl, events: ['event.created'] })).statusCode).toBe(401);

    const mine = (await api('POST', '/v1/webhooks', a.sec, { url: receiverUrl, events: ['event.created'] })).json<WebhookEndpointResponse>();
    expect((await api('DELETE', `/v1/webhooks/${mine.id}`, b.sec)).statusCode).toBe(404);
    expect((await api('GET', '/v1/webhooks', b.sec)).json()).toEqual({ endpoints: [] });

    for (let i = 0; i < 9; i++) await api('POST', '/v1/webhooks', a.sec, { url: receiverUrl, events: ['event.created'] });
    const over = await api('POST', '/v1/webhooks', a.sec, { url: receiverUrl, events: ['event.created'] });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ error: { code: 'limit_reached' } });
  });
});
