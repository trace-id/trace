import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { randomBase62 } from '../common/ids.js';

function key(tokenSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', tokenSecret, 'trace', 'webhook-secret-v1', 32));
}

export function newWebhookSecret(): string {
  return `whsec_${randomBase62(40)}`;
}

/**
 * Signing secrets must be recoverable to sign deliveries, so they are encrypted at rest
 * (AES-256-GCM) rather than hashed. Rotating TOKEN_SECRET invalidates stored secrets.
 */
export function sealSecret(secret: string, tokenSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(tokenSecret), iv);
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function openSecret(sealed: string, tokenSecret: string): string {
  const [version, iv, tag, ct] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported sealed secret');
  const decipher = createDecipheriv('aes-256-gcm', key(tokenSecret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
