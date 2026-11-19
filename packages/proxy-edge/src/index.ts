/**
 * Platform-neutral first-party proxy: www.example.com/trace/* goes to your Trace server. The platform adapters
 * (./netlify, ./vercel, ./fastly) only decide where the real client IP and JA4 fingerprint come from.
 *
 * Client-sent forwarding headers and the JA4 header are always removed first, so a visitor cannot choose the IP the
 * server sees. Set TRUST_PROXY on the server to the platform's egress ranges, or the forwarded IP is ignored.
 */

export interface EdgeProxyOptions<Ctx = unknown> {
  /** Origin of the Trace server, e.g. https://id-origin.example.com */
  upstream: string;
  /** Path prefix on your site. Default /trace */
  prefix?: string;
  /** Header the server reads the JA4 fingerprint from (TLS_FINGERPRINT_HEADER). Default x-ja4 */
  ja4Header?: string;
  /** The real client IP, from what the platform (not the client) provides. */
  clientIp?: (request: Request, context: Ctx) => string | undefined;
  /** The JA4 TLS fingerprint, if the platform exposes one. */
  ja4?: (request: Request, context: Ctx) => string | undefined;
}

// Headers a client could use to impersonate the proxy; always replaced or removed.
const SPOOFABLE = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'x-vercel-forwarded-for'];

export function createEdgeProxy<Ctx = unknown>(options: EdgeProxyOptions<Ctx>): (request: Request, context?: Ctx) => Promise<Response> {
  const upstream = options.upstream.replace(/\/+$/, '');
  const prefix = `/${(options.prefix ?? '/trace').replace(/^\/+|\/+$/g, '')}`;
  const ja4Header = (options.ja4Header ?? 'x-ja4').toLowerCase();

  return async (request, context = undefined as Ctx) => {
    const url = new URL(request.url);
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return new Response('Not found', { status: 404 });
    }
    const target = new URL(upstream + (url.pathname.slice(prefix.length) || '/') + url.search);

    // Read platform values before the visitor-supplied copies are stripped (some platforms use these headers).
    const ip = options.clientIp?.(request, context);
    const ja4 = options.ja4?.(request, context);

    const headers = new Headers(request.headers);
    for (const h of [...SPOOFABLE, ja4Header]) headers.delete(h);
    if (ip) headers.set('x-forwarded-for', ip);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
    headers.set('x-forwarded-host', url.host);
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
