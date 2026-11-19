import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { verifyWebhook } from '@trace-id/sdk-node/webhooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardedLookup, isBlockedAddress, validateWebhookUrl } from './net-guard.js';
import { newWebhookSecret, openSecret, sealSecret } from './secret-box.js';
import { sendWebhook } from './sender.js';

describe('isBlockedAddress', () => {
  it('blocks private, loopback, link-local, metadata, mapped and NAT64 forms', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
      '2002:7f00:1::',
      'not-an-ip',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
});

describe('validateWebhookUrl', () => {
  it('requires https, no credentials, no fragment, public host', () => {
    expect(validateWebhookUrl('https://hooks.example.com/x', false).ok).toBe(true);
    for (const url of [
      'http://hooks.example.com/x',
      'https://user:pw@hooks.example.com/',
      'https://hooks.example.com/#frag',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/',
      'https://db.internal/',
      'ftp://hooks.example.com/',
      'not a url',
    ]) {
      expect(validateWebhookUrl(url, false).ok, url).toBe(false);
    }
  });

  it('allows http and local targets only in insecure (dev) mode', () => {
    expect(validateWebhookUrl('http://127.0.0.1:9999/hook', true).ok).toBe(true);
  });
});

describe('guardedLookup', () => {
  const lookup = (host: string, allowPrivate: boolean) =>
    new Promise<string>((resolve, reject) =>
      guardedLookup(allowPrivate)(host, {}, (err, address) => (err ? reject(err) : resolve(String(address)))),
    );

  it('refuses names that resolve to loopback unless private targets are allowed', async () => {
    await expect(lookup('localhost', false)).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(lookup('localhost', true)).resolves.toMatch(/^(127\.0\.0\.1|::1)$/);
  });
});

describe('secret box', () => {
  it('round-trips and detects tampering or a different TOKEN_SECRET', () => {
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^whsec_[0-9A-Za-z]{40}$/);
    const sealed = sealSecret(secret, 'a'.repeat(32));
    expect(sealed).not.toContain(secret);
    expect(openSecret(sealed, 'a'.repeat(32))).toBe(secret);
    expect(() => openSecret(sealed, 'b'.repeat(32))).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => openSecret(parts.join('.'), 'a'.repeat(32))).toThrow();
  });
});

describe('sendWebhook', () => {
  let server: Server;
  let base: string;
  let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void = () => undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => handler(req, res, body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const body = JSON.stringify({ id: 'd1', type: 'event.created', createdAt: new Date().toISOString(), data: { eventId: 'e' } });
  const send = (path = '/hook', allowInsecure = true, timeoutMs = 2000) =>
    sendWebhook({ url: `${base}${path}`, body, secret: 'whsec_x', deliveryId: 'd1', timeoutMs, allowInsecure });

  it('signs so the sdk-node verifier accepts it', async () => {
    let seen: { sig?: string; id?: string; body?: string } = {};
    handler = (req, res, b) => {
      seen = { sig: req.headers['x-signature'] as string, id: req.headers['x-webhook-id'] as string, body: b };
      res.writeHead(204).end();
    };
    expect(await send()).toEqual({ ok: true, status: 204, error: null });
    expect(seen.id).toBe('d1');
    expect(verifyWebhook({ body: seen.body ?? '', signature: seen.sig, secret: 'whsec_x' }).id).toBe('d1');
  });

  it('treats non-2xx and redirects as failures and does not follow redirects', async () => {
    handler = (_req, res) => res.writeHead(500).end('boom');
    expect(await send()).toEqual({ ok: false, status: 500, error: 'http_500' });
    let followed = false;
    handler = (req, res) => {
      if (req.url === '/elsewhere') followed = true;
      res.writeHead(302, { Location: '/elsewhere' }).end();
    };
    expect(await send()).toMatchObject({ ok: false, error: 'redirect_not_followed' });
    expect(followed).toBe(false);
  });

  it('times out on a hanging receiver', async () => {
    handler = () => undefined;
    expect(await send('/hang', true, 200)).toEqual({ ok: false, status: null, error: 'timeout' });
  });

  it('refuses http and loopback targets outside insecure mode', async () => {
    expect(await send('/hook', false)).toMatchObject({ ok: false, error: 'insecure_url' });
    const r = await sendWebhook({
      url: base.replace('http://', 'https://'),
      body,
      secret: 'whsec_x',
      deliveryId: 'd1',
      timeoutMs: 2000,
      allowInsecure: false,
    });
    expect(r).toMatchObject({ ok: false, error: 'blocked_address' });
  });
});
