import { type IdentifyContext, type Trace, TraceError } from '../trace.js';

/** What every adapter hands to the shared router. */
export interface RouteInput {
  method: string;
  /** Path after the mount prefix, e.g. "/v1/identify". */
  path: string;
  query: URLSearchParams;
  body: unknown;
  ip: string;
  headers: IdentifyContext['headers'];
  /** The full path the identify route lives at, for the visitor cookie. */
  identifyPath: string;
  /** Absolute request URL, when the framework knows it; otherwise rebuilt from the Host header. */
  url?: string;
}

/** https://<host><identify path>?<query>, from the Host header (proxies that terminate TLS still serve https to the agent). */
function requestUrl(input: RouteInput): string | undefined {
  const h = input.headers;
  const raw = typeof (h as Headers).get === 'function' ? (h as Headers).get('host') : (h as Record<string, string | string[] | undefined>)['host'];
  const host = Array.isArray(raw) ? raw[0] : raw;
  if (!host) return undefined;
  const q = input.query.toString();
  return `https://${host}${input.identifyPath}${q ? `?${q}` : ''}`;
}

export interface RouteOutput {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const MAX_BODY = 64 * 1024;

/**
 * The two endpoints the browser SDK calls, framework-free:
 *   POST {prefix}/v1/identify          identify this browser
 *   POST {prefix}/v1/identify/forget   clear the visitor cookie (the SDK's disable(true))
 * Same-origin by default: mount it on your own API and point the SDK's endpoint at {your API}{prefix}.
 */
export async function route(trace: Trace, input: RouteInput): Promise<RouteOutput | null> {
  const path = input.path.replace(/\/+$/, '');
  if (path !== '/v1/identify' && path !== '/v1/identify/forget') return null;
  const json = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (input.method === 'OPTIONS') {
    return { status: 204, headers: { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }, body: null };
  }
  if (input.method !== 'POST') return { status: 405, headers: { ...json, Allow: 'POST' }, body: { error: { code: 'method_not_allowed', message: 'Use POST' } } };
  if (path === '/v1/identify/forget') {
    const clear = trace.forgetCookie(input.identifyPath);
    return { status: 204, headers: clear ? { 'Set-Cookie': clear } : {}, body: null };
  }
  if (typeof input.body === 'string' && input.body.length > MAX_BODY) {
    return { status: 413, headers: json, body: { error: { code: 'payload_too_large', message: 'Body over 64 KB' } } };
  }
  try {
    const out = await trace.identify(input.body, {
      ip: input.ip,
      headers: input.headers,
      apiKey: input.query.get('apiKey'),
      cookiePath: input.identifyPath,
      method: input.method,
      url: input.url ?? requestUrl(input),
    });
    return { status: 200, headers: { ...json, ...(out.setCookie ? { 'Set-Cookie': out.setCookie } : {}) }, body: out.result };
  } catch (err) {
    if (err instanceof TraceError) return { status: err.status, headers: json, body: { error: { code: err.code, message: err.message } } };
    throw err;
  }
}

export function normalizePrefix(prefix: string | undefined): string {
  if (!prefix || prefix === '/') return '';
  return `/${prefix.replace(/^\/+|\/+$/g, '')}`;
}
