import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { type VisitorHistoryResponse } from '@tbdname/signals/api';
import { TEST_SCORING_CONFIG } from '@tbdname/signals/testing';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { newVisitorId, uuidv7 } from '../../src/common/ids.js';
import { parseEnv } from '../../src/config/env.js';
import { MaintenanceService } from '../../src/infra/maintenance.service.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { generateKey } from '../../src/keys/key-crypto.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const DAY = 24 * 60 * 60_000;

describe.skipIf(!DATABASE_URL)('visitors API and retention (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  const projects: { id: string; sec: string }[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    for (const [name, retentionDays] of [
      ['visitors-a', 30],
      ['visitors-b', 7],
    ] as const) {
      const project = await prisma.project.create({ data: { name, retentionDays } });
      const sec = generateKey('secret');
      await prisma.apiKey.create({ data: { projectId: project.id, type: 'secret', prefix: sec.prefix, hash: sec.hash } });
      projects.push({ id: project.id, sec: sec.key });
    }
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL,
      TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
      RETENTION_MAX_DAYS: '60',
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

  async function seedVisitor(projectId: string, eventAges: number[], lastSeenAgoDays = 0): Promise<string> {
    const id = newVisitorId();
    const now = Date.now();
    await prisma.visitor.create({
      data: {
        id,
        projectId,
        firstSeenAt: new Date(now - Math.max(...eventAges, 0) * DAY),
        lastSeenAt: new Date(now - lastSeenAgoDays * DAY),
        signalSummary: {},
        eventCount: eventAges.length,
      },
    });
    await prisma.event.createMany({
      data: eventAges.map((days, i) => {
        const createdAt = new Date(now - days * DAY - i);
        return {
          id: uuidv7(createdAt),
          createdAt,
          projectId,
          visitorId: id,
          matchKind: 'new',
          confidence: 1,
          suspectScore: 0,
          reasons: [],
          signals: {},
        };
      }),
    });
    return id;
  }

  const get = (url: string, key: string): Promise<LightMyRequestResponse> =>
    http.inject({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });
  const del = (url: string, key: string): Promise<LightMyRequestResponse> =>
    http.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${key}` } });

  it('pages through history newest first with an opaque cursor', async () => {
    const [a] = projects as [{ id: string; sec: string }];
    const visitorId = await seedVisitor(a.id, [0, 0, 0, 1, 2]);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const res = await get(`/v1/visitors/${visitorId}${qs}`, a.sec);
      expect(res.statusCode).toBe(200);
      const body = res.json<VisitorHistoryResponse>();
      expect(body.eventCount).toBe(5);
      seen.push(...body.events.map((e) => e.createdAt));
      cursor = body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect([...seen].sort().reverse()).toEqual(seen);
  });

  it('validates ids, cursors and limits', async () => {
    const [a] = projects as [{ id: string; sec: string }];
    const visitorId = await seedVisitor(a.id, [0]);
    expect((await get('/v1/visitors/short', a.sec)).statusCode).toBe(400);
    expect((await get(`/v1/visitors/${visitorId}?limit=51`, a.sec)).statusCode).toBe(400);
    expect((await get(`/v1/visitors/${visitorId}?cursor=junk`, a.sec)).json()).toMatchObject({
      error: { code: 'invalid_cursor' },
    });
    expect((await get(`/v1/visitors/${newVisitorId()}`, a.sec)).statusCode).toBe(404);
  });

  it("isolates projects: another project's key gets 404 for read and delete", async () => {
    const [a, b] = projects as [{ id: string; sec: string }, { id: string; sec: string }];
    const visitorId = await seedVisitor(a.id, [0]);
    expect((await get(`/v1/visitors/${visitorId}`, b.sec)).statusCode).toBe(404);
    expect((await del(`/v1/visitors/${visitorId}`, b.sec)).statusCode).toBe(404);
    expect(await prisma.visitor.count({ where: { id: visitorId } })).toBe(1);
  });

  it('deletes a visitor with all its events, and 404s afterwards', async () => {
    const [a] = projects as [{ id: string; sec: string }];
    const visitorId = await seedVisitor(a.id, [0, 1]);
    expect((await del(`/v1/visitors/${visitorId}`, a.sec)).statusCode).toBe(204);
    expect(await prisma.event.count({ where: { visitorId } })).toBe(0);
    expect((await get(`/v1/visitors/${visitorId}`, a.sec)).statusCode).toBe(404);
    expect((await del(`/v1/visitors/${visitorId}`, a.sec)).statusCode).toBe(404);
  });

  it('applies per-project retention and drops partitions older than the max', async () => {
    const [a, b] = projects as [{ id: string; sec: string }, { id: string; sec: string }];
    const keepA = await seedVisitor(a.id, [1, 20, 40], 1);
    const goneA = await seedVisitor(a.id, [45], 45);
    const keepB = await seedVisitor(b.id, [1, 10], 1);

    // Same lock_timeout discipline as the server's own partition DDL, retried, so this test
    // never deadlocks ingest running in parallel test files.
    for (let attempt = 0; ; attempt++) {
      try {
        await prisma.$transaction([
          prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '500ms'`),
          prisma.$executeRawUnsafe(
            `CREATE TABLE IF NOT EXISTS "events_2020_01" PARTITION OF "events" FOR VALUES FROM ('2020-01-01 00:00:00+00') TO ('2020-02-01 00:00:00+00')`,
          ),
        ]);
        break;
      } catch (err) {
        if (attempt >= 10) throw err;
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const result = await app.get(MaintenanceService).applyRetention();
    expect(result.partitionsDropped).toBeGreaterThanOrEqual(1);

    const ages = async (visitorId: string) =>
      (await prisma.event.findMany({ where: { visitorId }, select: { createdAt: true } }))
        .map((e) => Math.round((Date.now() - e.createdAt.getTime()) / DAY))
        .sort((x, y) => x - y);
    expect(await ages(keepA)).toEqual([1, 20]);
    expect(await ages(keepB)).toEqual([1]);
    expect(await prisma.visitor.count({ where: { id: goneA } })).toBe(0);
    const [row] = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('events_2020_01')::text AS t`;
    expect(row?.t).toBeNull();
  });
});
