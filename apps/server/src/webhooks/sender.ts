import { createHmac } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { guardedLookup, isBlockedAddress } from './net-guard.js';

const MAX_RESPONSE_BYTES = 64 * 1024;

export function signatureHeader(secret: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export interface SendResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

export interface SendOptions {
  url: string;
  body: string;
  secret: string;
  deliveryId: string;
  timeoutMs: number;
  allowInsecure: boolean;
  now?: Date;
}

/**
 * One POST, no redirects followed, response body read up to 64 KB and discarded, hard
 * timeout. Only 2xx counts as delivered.
 */
export function sendWebhook(opts: SendOptions): Promise<SendResult> {
  const url = new URL(opts.url);
  const timestamp = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const request = url.protocol === 'https:' ? httpsRequest : opts.allowInsecure ? httpRequest : null;
  if (!request) return Promise.resolve({ ok: false, status: null, error: 'insecure_url' });
  // Node connects to IP literals directly without calling lookup, so check them here.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!opts.allowInsecure && isIP(host) !== 0 && isBlockedAddress(host)) {
    return Promise.resolve({ ok: false, status: null, error: 'blocked_address' });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: SendResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const req = request(
      url,
      {
        method: 'POST',
        lookup: guardedLookup(opts.allowInsecure),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(opts.body),
          'User-Agent': 'trace-webhooks/1',
          'X-Webhook-Id': opts.deliveryId,
          'X-Webhook-Timestamp': String(timestamp),
          'X-Signature': signatureHeader(opts.secret, timestamp, opts.body),
        },
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) res.destroy();
        });
        const done = () => {
          if (status >= 200 && status < 300) finish({ ok: true, status, error: null });
          else if (status >= 300 && status < 400) finish({ ok: false, status, error: 'redirect_not_followed' });
          else finish({ ok: false, status, error: `http_${status}` });
        };
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, status: null, error: 'timeout' });
    }, opts.timeoutMs);
    req.on('error', (err: NodeJS.ErrnoException & { code?: string }) => {
      finish({ ok: false, status: null, error: (err.code ?? err.message).slice(0, 100) });
    });
    req.end(opts.body);
  });
}
