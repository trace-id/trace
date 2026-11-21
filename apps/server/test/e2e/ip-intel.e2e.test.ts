import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { TEST_SCORING_CONFIG } from '@trace-id/signals/testing';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { FileIntelSource, ReloadableIpIntel } from '../../src/intel/build.js';
import { IpProvidersService, type ProviderView } from '../../src/intel/ip-providers.service.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const DASHBOARD = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const SECRET = 'tok-SECRET-VALUE-AAAA1234';
const SECRET_2 = 'tok-SECOND-VALUE-BBBB5678';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe.skipIf(!DATABASE_URL)('IP providers, keys, usage and instance settings (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  let intel: ReloadableIpIntel;
  const cookies: Record<string, string> = {};
  const emails = { admin: 'ipadmin@example.test', other: 'ipother@example.test' };

  const cookieHeader = (res: LightMyRequestResponse): string => {
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c) => c.split(';')[0]).join('; ');
  };

  const call = (who: 'admin' | 'other', method: Method, url: string, payload?: unknown, origin: string | null = DASHBOARD) =>
    http.inject({
      method,
      url,
      headers: { ...(cookies[who] ? { cookie: cookies[who] } : {}), ...(origin ? { origin } : {}) },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    await prisma.ipProvider.deleteMany();
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL,
      TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
      DASHBOARD_URL: DASHBOARD,
      DASHBOARD_ALLOW_SIGNUP: 'true',
    });
    intel = new ReloadableIpIntel(new FileIntelSource({}), [], { timeoutMs: 400, cacheTtlMs: 3_600_000 });
    app = await createApp({ env, scoring: TEST_SCORING_CONFIG, ipIntel: intel });
    http = app.getHttpAdapter().getInstance();
    for (const [who, email] of Object.entries(emails)) {
      const res = await http.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { 'content-type': 'application/json', origin: DASHBOARD },
        payload: { email, password: PASSWORD, name: who },
      });
      expect(res.statusCode).toBe(200);
      cookies[who] = cookieHeader(res);
    }
    // The first account administers the instance: make ours the oldest, whatever else is in this database.
    await prisma.user.update({ where: { email: emails.admin }, data: { createdAt: new Date('1970-01-01T00:00:00Z') } });
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.ipProvider.deleteMany();
      await prisma.ipProviderUsage.deleteMany({ where: { providerRef: { startsWith: 'e2e' } } });
      await prisma.instanceSetting.deleteMany({ where: { OR: [{ key: { startsWith: 'ip.' } }, { key: { startsWith: 'redis.' } }] } });
      await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
      await prisma.$disconnect();
    }
  });

  it('shows the instance pages to the first account only', async () => {
    expect((await call('admin', 'GET', '/v1/instance')).json()).toEqual({ admin: true });
    expect((await call('other', 'GET', '/v1/instance')).json()).toEqual({ admin: false });
    for (const url of ['/v1/ip-intel', '/v1/ip-intel/usage', '/v1/instance/settings']) {
      const res = await call('other', 'GET', url);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error?.code ?? res.json().code, url).toBe('instance_admin_required');
    }
    expect((await http.inject({ method: 'GET', url: '/v1/ip-intel' })).statusCode).toBe(401);
    expect((await call('other', 'POST', '/v1/ip-intel/providers', { provider: 'ipinfo' })).statusCode).toBe(403);
  });

  it('refuses writes from another origin', async () => {
    const res = await call('admin', 'POST', '/v1/ip-intel/providers', { provider: 'proxycheck' }, 'https://evil.example.test');
    expect(res.statusCode).toBe(403);
  });

  it('lists the providers it knows, with the fields to ask for', async () => {
    const o = (await call('admin', 'GET', '/v1/ip-intel')).json();
    const ids = o.registry.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['ipinfo', 'ipgeolocation', 'proxycheck', 'ipqualityscore']));
    const ipinfo = o.registry.find((r: { id: string }) => r.id === 'ipinfo');
    expect(ipinfo.fields.map((f: { name: string }) => f.name)).toEqual(['token', 'plan']);
    expect(JSON.stringify(o.registry)).not.toContain('build');
    expect(o.providers).toEqual([]);
  });

  it('validates what it is given', async () => {
    const bad = async (body: unknown, part: string) => {
      const res = await call('admin', 'POST', '/v1/ip-intel/providers', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(res.json()), JSON.stringify(body)).toContain(part);
    };
    await bad({ provider: 'nope' }, 'Unknown provider');
    await bad({ provider: 'ipinfo', key: { values: {} } }, 'Access token is required');
    await bad({ provider: 'ipinfo', settings: { plan: 'gold' }, key: { values: { token: SECRET } } }, 'must be one of');
    await bad({ provider: 'ipinfo', sharePercent: 150 }, 'sharePercent');
    await bad({ provider: 'ip-api' }, 'pro key');
    await bad({ provider: 'cdn-headers', key: { values: {} } }, 'takes no key');
    await bad({ provider: 'ipinfo', extra: true }, '(root)');
  });

  let provider: ProviderView;

  it('creates a provider with a key and never returns the key', async () => {
    const res = await call('admin', 'POST', '/v1/ip-intel/providers', {
      provider: 'ipinfo',
      label: 'ipinfo (free)',
      settings: { plan: 'lite' },
      dailyLimit: 1000,
      key: { label: 'main', values: { token: SECRET }, weight: 3 },
    });
    expect(res.statusCode).toBe(201);
    provider = res.json();
    expect(provider).toMatchObject({ provider: 'ipinfo', label: 'ipinfo (free)', enabled: true, sharePercent: 100, dailyLimit: 1000, strategy: 'weighted', status: 'ok', settings: { plan: 'lite' } });
    expect(provider.keys).toHaveLength(1);
    expect(provider.keys[0]).toMatchObject({ label: 'main', hint: '••••1234', weight: 3, enabled: true });
    expect(JSON.stringify(provider)).not.toContain(SECRET);
    // At rest the key is encrypted.
    const row = await prisma.ipProviderKey.findFirstOrThrow({ where: { providerId: provider.id } });
    expect(row.sealed).toMatch(/^v1\./);
    expect(row.sealed).not.toContain('SECRET');
    expect(JSON.stringify((await call('admin', 'GET', '/v1/ip-intel')).json())).not.toContain(SECRET);
  });

  it('adds, edits and removes keys, and keeps a saved key when only the label changes', async () => {
    const added = await call('admin', 'POST', `/v1/ip-intel/providers/${provider.id}/keys`, { label: 'backup', values: { token: SECRET_2 }, dailyLimit: 500 });
    expect(added.statusCode).toBe(201);
    const keys = (added.json() as ProviderView).keys;
    expect(keys.map((k) => k.hint)).toEqual(['••••1234', '••••5678']);
    const second = keys[1]!;

    const renamed = await call('admin', 'PATCH', `/v1/ip-intel/providers/${provider.id}/keys/${second.id}`, { label: 'spare', weight: 2, enabled: false });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as ProviderView).keys[1]).toMatchObject({ label: 'spare', weight: 2, enabled: false, hint: '••••5678' });

    // Replacing the secret changes the hint.
    const rotated = await call('admin', 'PATCH', `/v1/ip-intel/providers/${provider.id}/keys/${second.id}`, { values: { token: 'tok-ROTATED-VALUE-CCCC9999' } });
    expect((rotated.json() as ProviderView).keys[1]?.hint).toBe('••••9999');

    expect((await call('admin', 'PATCH', `/v1/ip-intel/providers/${provider.id}/keys/${second.id}`, { values: { token: '' } })).statusCode).toBe(200);
    const unchanged = (await call('admin', 'GET', '/v1/ip-intel')).json().providers[0] as ProviderView;
    expect(unchanged.keys[1]?.hint).toBe('••••9999');

    const removed = await call('admin', 'DELETE', `/v1/ip-intel/providers/${provider.id}/keys/${second.id}`);
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as ProviderView).keys).toHaveLength(1);
    expect((await call('admin', 'DELETE', `/v1/ip-intel/providers/${provider.id}/keys/${second.id}`)).statusCode).toBe(404);
    expect((await call('admin', 'DELETE', `/v1/ip-intel/providers/not-a-uuid/keys/${second.id}`)).statusCode).toBe(404);
  });

  it('reports a provider with no usable key as down', async () => {
    const created = await call('admin', 'POST', '/v1/ip-intel/providers', { provider: 'ipqualityscore' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'down', statusDetail: 'Add an API key' });
    await call('admin', 'DELETE', `/v1/ip-intel/providers/${(created.json() as ProviderView).id}`);
  });

  it('runs a provider that needs no key, and turns providers off and on', async () => {
    const created = await call('admin', 'POST', '/v1/ip-intel/providers', { provider: 'proxycheck', sharePercent: 40, priority: 10, strategy: 'failover' });
    expect(created.statusCode).toBe(201);
    const pc = created.json() as ProviderView;
    expect(pc).toMatchObject({ status: 'ok', keys: [], sharePercent: 40, priority: 10, strategy: 'failover' });
    const off = await call('admin', 'PATCH', `/v1/ip-intel/providers/${pc.id}`, { enabled: false });
    expect(off.json()).toMatchObject({ enabled: false, status: 'disabled' });
    const list = (await call('admin', 'GET', '/v1/ip-intel')).json().providers as ProviderView[];
    expect(list.map((p) => p.provider)).toEqual(['proxycheck', 'ipinfo']);
    expect((await call('admin', 'PATCH', `/v1/ip-intel/providers/${pc.id}`, { sharePercent: -1 })).statusCode).toBe(400);
    expect((await call('admin', 'PATCH', `/v1/ip-intel/providers/${pc.id}`, { settings: { nope: 'x' } })).statusCode).toBe(200);
    expect((await call('admin', 'DELETE', `/v1/ip-intel/providers/${pc.id}`)).statusCode).toBe(204);
  });

  it('counts usage per provider and key, and stores it', async () => {
    const service = app.get(IpProvidersService);
    const keyId = provider.keys[0]!.id;
    for (let i = 0; i < 3; i++) intel.hub.emit({ providerRef: provider.id, keyId, outcome: 'ok', status: 200, latencyMs: 100 });
    intel.hub.emit({ providerRef: provider.id, keyId, outcome: 'rateLimited', status: 429, latencyMs: 50 });
    intel.hub.emit({ providerRef: provider.id, keyId: null, outcome: 'skipped', status: null, latencyMs: 0 });

    const live = (await call('admin', 'GET', '/v1/ip-intel/usage?days=7')).json();
    expect(live.byProvider[provider.id]).toMatchObject({ requests: 4, ok: 3, rateLimited: 1, skipped: 1, avgLatencyMs: 88 });
    expect(live.byKey[keyId]).toMatchObject({ requests: 4 });

    await service.flush();
    await service.flush();
    const row = await prisma.ipProviderUsage.findFirstOrThrow({ where: { providerRef: provider.id, keyRef: keyId } });
    expect(row).toMatchObject({ requests: 4, ok: 3, rateLimited: 1, provider: 'ipinfo' });
    const stored = (await call('admin', 'GET', '/v1/ip-intel/usage?days=7')).json();
    expect(stored.byProvider[provider.id]).toMatchObject({ requests: 4, ok: 3, rateLimited: 1 });

    // More usage adds to the stored row instead of replacing it.
    intel.hub.emit({ providerRef: provider.id, keyId, outcome: 'ok', status: 200, latencyMs: 10 });
    await service.flush();
    expect((await prisma.ipProviderUsage.findFirstOrThrow({ where: { providerRef: provider.id, keyRef: keyId } })).requests).toBe(5);
  });

  it('refuses to test an address it should not send out', async () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', 'not-an-ip']) {
      const res = await call('admin', 'POST', '/v1/ip-intel/test', { providerId: provider.id, ip });
      expect(res.statusCode, ip).toBe(400);
    }
    expect((await call('admin', 'POST', '/v1/ip-intel/test', { ip: '8.8.8.8' })).statusCode).toBe(400);
  });

  it('changes instance settings, validates them and returns to the fallback on null', async () => {
    const before = (await call('admin', 'GET', '/v1/instance/settings')).json().settings as { key: string; value: unknown; source: string }[];
    expect(before.find((s) => s.key === 'ip.cacheHours')).toMatchObject({ value: 24, source: 'environment' });

    const set = await call('admin', 'PATCH', '/v1/instance/settings', { 'ip.cacheHours': 12, 'ip.timeoutMs': 800, 'ip.sharedCache': false });
    expect(set.statusCode).toBe(200);
    const after = set.json().settings as { key: string; value: unknown; source: string }[];
    expect(after.find((s) => s.key === 'ip.cacheHours')).toMatchObject({ value: 12, source: 'dashboard' });
    expect(after.find((s) => s.key === 'ip.sharedCache')).toMatchObject({ value: false, source: 'dashboard' });
    expect(intel.runtime).toMatchObject({ timeoutMs: 800, cacheTtlMs: 12 * 3_600_000 });
    expect(intel.runtime.sharedCache).toBeUndefined();

    for (const bad of [{ 'ip.cacheHours': 100000 }, { 'ip.timeoutMs': 'fast' }, { 'ip.sharedCache': 'yes' }, { 'unknown.key': 1 }, {}]) {
      expect((await call('admin', 'PATCH', '/v1/instance/settings', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }

    const reset = await call('admin', 'PATCH', '/v1/instance/settings', { 'ip.cacheHours': null, 'ip.timeoutMs': null, 'ip.sharedCache': null });
    expect((reset.json().settings as { key: string; source: string }[]).find((s) => s.key === 'ip.cacheHours')?.source).toBe('environment');
    expect(intel.runtime.timeoutMs).toBe(400);
  });

  it('sets the Redis address from the dashboard, keeps it encrypted and never shows it back', async () => {
    const status = async () => (await call('admin', 'GET', '/v1/instance/redis')).json();
    expect(await status()).toEqual({ status: 'off', target: null, source: 'none' });
    expect((await call('other', 'GET', '/v1/instance/redis')).statusCode).toBe(403);

    for (const bad of ['http://localhost:6379', 'localhost:6379', 'redis://', '']) {
      expect((await call('admin', 'PATCH', '/v1/instance/settings', { 'redis.url': bad })).statusCode, bad).toBe(400);
    }

    const url = 'redis://default:S3cretPassw0rd@127.0.0.1:1';
    const saved = await call('admin', 'PATCH', '/v1/instance/settings', { 'redis.url': url });
    expect(saved.statusCode).toBe(200);
    expect(JSON.stringify(saved.json())).not.toContain('S3cretPassw0rd');
    expect((saved.json().settings as { key: string; value: unknown; isSet: boolean; source: string }[]).find((s) => s.key === 'redis.url')).toMatchObject({ value: null, isSet: true, source: 'dashboard' });
    const row = await prisma.instanceSetting.findUniqueOrThrow({ where: { key: 'redis.url' } });
    expect(row.value).toMatch(/^v1\./);
    expect(row.value).not.toContain('S3cret');

    const now = await status();
    expect(now).toMatchObject({ target: '127.0.0.1:1', source: 'dashboard' });
    expect(now.status).not.toBe('off');
    expect(JSON.stringify(now)).not.toContain('S3cret');
    expect(JSON.stringify((await call('admin', 'GET', '/v1/ip-intel')).json())).not.toContain('S3cret');

    // A failed connection test says why, without echoing the address.
    const probe = await call('admin', 'POST', '/v1/instance/redis/test', { url });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({ ok: false });
    expect(JSON.stringify(probe.json())).not.toContain('S3cret');
    expect((await call('admin', 'POST', '/v1/instance/redis/test', { url: 'http://x' })).statusCode).toBe(400);
    expect((await call('other', 'POST', '/v1/instance/redis/test', { url })).statusCode).toBe(403);

    const cleared = await call('admin', 'PATCH', '/v1/instance/settings', { 'redis.url': null });
    expect(cleared.statusCode).toBe(200);
    expect(await status()).toEqual({ status: 'off', target: null, source: 'none' });
    expect((await call('admin', 'POST', '/v1/instance/redis/test', {})).statusCode).toBe(400);
  });

  it('deleting a provider removes its keys', async () => {
    expect((await call('admin', 'DELETE', `/v1/ip-intel/providers/${provider.id}`)).statusCode).toBe(204);
    expect(await prisma.ipProviderKey.count({ where: { providerId: provider.id } })).toBe(0);
    expect((await call('admin', 'DELETE', `/v1/ip-intel/providers/${provider.id}`)).statusCode).toBe(404);
  });
});
