import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SEC = 400 * 24 * 60 * 60;
const TOKEN = /^v1\.([0-9A-Za-z]{20})\.(\d{1,12})\.([\w-]{43})$/;

function sign(secret: string, projectId: string, visitorId: string, iat: number): string {
  return createHmac('sha256', secret).update(`v1.${projectId}.${visitorId}.${iat}`).digest('base64url');
}

/**
 * The persisted visitor token. Bound to the project by the HMAC, so it cannot be replayed
 * against another project, and a forged visitorId fails verification. A stolen token still
 * has to agree with the device's signals before the engine trusts it.
 */
export function issueToken(secret: string, projectId: string, visitorId: string, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  return `v1.${visitorId}.${iat}.${sign(secret, projectId, visitorId, iat)}`;
}

export function verifyToken(
  secret: string,
  projectId: string,
  token: string | undefined,
  now: Date = new Date(),
): string | null {
  if (!token) return null;
  const m = TOKEN.exec(token);
  if (!m) return null;
  const [, visitorId = '', iatText = '', sig = ''] = m;
  const iat = Number(iatText);
  const age = Math.floor(now.getTime() / 1000) - iat;
  if (age < -300 || age > MAX_AGE_SEC) return null;
  const expected = Buffer.from(sign(secret, projectId, visitorId, iat));
  const presented = Buffer.from(sig);
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;
  return visitorId;
}
