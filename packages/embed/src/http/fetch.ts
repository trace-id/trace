import { type Trace } from '../trace.js';
import { normalizePrefix, route } from './route.js';

export interface FetchHandlerOptions {
  /** Where the routes are mounted. Default "/trace", so the SDK's endpoint is https://your-site/trace. */
  prefix?: string;
  /** The client IP. Default: the first X-Forwarded-For address, then X-Real-IP. Only trust these behind your proxy. */
  getIp?: (req: Request) => string;
}

function defaultIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? req.headers.get('x-real-ip') ?? '').trim() || '0.0.0.0';
}

/**
 * A Web-standard handler: Next.js route handlers, Remix, Hono, Bun, Deno, SvelteKit, Astro.
 *
 *   // Next.js: app/trace/[...path]/route.ts
 *   const handler = toFetchHandler(trace);
 *   export { handler as POST, handler as OPTIONS };
 *
 * Returns 404 for paths it does not own, so it can sit in front of other routes.
 */
export function toFetchHandler(trace: Trace, opts: FetchHandlerOptions = {}): (req: Request) => Promise<Response> {
  const prefix = normalizePrefix(opts.prefix ?? '/trace');
  const getIp = opts.getIp ?? defaultIp;
  return async (req) => {
    const url = new URL(req.url);
    if (prefix && !url.pathname.startsWith(prefix)) return new Response(null, { status: 404 });
    const out = await route(trace, {
      method: req.method,
      path: url.pathname.slice(prefix.length) || '/',
      query: url.searchParams,
      url: req.url,
      body: req.method === 'POST' ? await req.text() : null,
      ip: getIp(req),
      headers: req.headers,
      identifyPath: `${prefix}/v1/identify`,
    });
    if (!out) return new Response(null, { status: 404 });
    return new Response(out.body === null ? null : JSON.stringify(out.body), { status: out.status, headers: out.headers });
  };
}
