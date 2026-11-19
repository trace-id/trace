import { createCipheriv, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const VERSION = 1;
const AAD = Buffer.from('trace-sealed-v1');

/**
 * Format: base64url( version(1) | iv(12) | AES-256-GCM(deflateRaw(JSON)) | tag(16) ), with a fixed AAD. Mirrored by
 * unsealEventResult in @trace-id/sdk-node/sealed.
 */
export function sealResult(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'))), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]).toString('base64url');
}
