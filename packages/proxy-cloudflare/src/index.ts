/**
 * Cloudflare Worker that serves Trace from your own site (first-party mode): www.example.com/trace/* goes to your
 * trace server. Ad blockers do not block your own domain, Safari keeps the visitor cookie, and the real client IP
 * and (with Bot Management) the JA4 TLS fingerprint reach the server.
 *
 * Deploy: set UPSTREAM to your server origin (https://id-origin.example.com), route www.example.com/trace/* to the
 * worker, and on the server set TRUST_PROXY to Cloudflare's ranges, TLS_FINGERPRINT_HEADER=x-ja4 and
 * VISITOR_COOKIE_PATH=/trace/v1/identify (or let this worker rewrite the path, which it does).
 */

export interface ProxyOptions {
  /** Origin of the trace server, e.g. https://id-origin.example.com */
  upstream: string;
  /** Path prefix on your site. Default /trace */
  prefix?: string;
  /** Header the server reads the JA4 fingerprint from (TLS_FINGERPRINT_HEADER). Default x-ja4 */
  ja4Header?: string;
}

interface CfProperties {
  botManagement?: { ja4?: string };
}

type CfRequest = Request & { cf?: CfProperties };

// Headers a client could use to impersonate the proxy; always replaced or removed.
const SPOOFABLE = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip-forwarded'];

export function createProxy(options: ProxyOptions): (request: Request) => Promise<Response> {
  const upstream = options.upstream.replace(/\/+$/, '');
  const prefix = `/${(options.prefix ?? '/trace').replace(/^\/+|\/+$/g, '')}`;
  const ja4Header = (options.ja4Header ?? 'x-ja4').toLowerCase();

  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return new Response('Not found', { status: 404 });
    }
    const target = new URL(upstream + (url.pathname.slice(prefix.length) || '/') + url.search);

    const headers = new Headers(request.headers);
    for (const h of [...SPOOFABLE, ja4Header]) headers.delete(h);
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) headers.set('x-forwarded-for', clientIp);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
    headers.set('x-forwarded-host', url.host);
    const ja4 = (request as CfRequest).cf?.botManagement?.ja4;
    if (ja4) headers.set(ja4Header, ja4);

    const init: RequestInit & { duplex?: string } = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }
    const res = await fetch(target, init);

    // The server scopes its cookie to /v1/identify; on this site that path lives under the prefix.
    const out = new Headers(res.headers);
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if (cookies.length > 0) {
      out.delete('set-cookie');
      for (const c of cookies) out.append('set-cookie', c.replace(/;\s*Path=\/v1\//i, `; Path=${prefix}/v1/`));
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  };
}

interface Env {
  UPSTREAM: string;
  PREFIX?: string;
  JA4_HEADER?: string;
}

/** Ready-to-deploy worker: configure with the UPSTREAM (and optional PREFIX, JA4_HEADER) variables. */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createProxy({ upstream: env.UPSTREAM, prefix: env.PREFIX, ja4Header: env.JA4_HEADER })(request);
  },
};
