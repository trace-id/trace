const TOKEN = /^[\w.-]{1,512}$/;
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60; // the longest lifetime browsers accept

export interface CookieOptions {
  name: string;
  secure: boolean;
  domain?: string | undefined;
  /** Default /v1/identify; a path proxy needs its prefix here (/trace/v1/identify). */
  path?: string | undefined;
}

/** The visitor token from a Cookie header, or null. Invalid values are ignored rather than rejected. */
export function readVisitorCookie(header: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return TOKEN.test(value) ? value : null;
  }
  return null;
}

function attributes(opts: CookieOptions, maxAge: number): string {
  // SameSite=Lax: sent only when this server is same-site with the page, so it can never act as a third-party cookie.
  return [
    `Path=${opts.path ?? '/v1/identify'}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(opts.secure ? ['Secure'] : []),
    ...(opts.domain ? [`Domain=${opts.domain}`] : []),
  ].join('; ');
}

export function visitorCookie(token: string, opts: CookieOptions): string {
  return `${opts.name}=${token}; ${attributes(opts, MAX_AGE_SECONDS)}`;
}

export function clearedVisitorCookie(opts: CookieOptions): string {
  return `${opts.name}=; ${attributes(opts, 0)}`;
}
