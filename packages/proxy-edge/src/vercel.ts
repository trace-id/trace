import { createEdgeProxy, type EdgeProxyOptions } from './index.js';

/**
 * Vercel Edge route, `app/trace/[...path]/route.ts`:
 *
 *     import { vercelProxy } from '@trace-id/proxy-edge/vercel';
 *     const handler = vercelProxy({ upstream: 'https://id.example.com' });
 *     export { handler as GET, handler as POST, handler as OPTIONS };
 *     export const runtime = 'edge';
 *
 * Vercel sets x-real-ip itself and replaces any visitor-sent value, so it is the trusted source of the client IP.
 * The JA4 fingerprint is read from x-vercel-ja4-digest when the plan provides it.
 */
export function vercelProxy(options: Omit<EdgeProxyOptions, 'clientIp' | 'ja4'>) {
  const proxy = createEdgeProxy({
    ...options,
    clientIp: (req) => req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    ja4: (req) => req.headers.get('x-vercel-ja4-digest') ?? undefined,
  });
  return (request: Request) => proxy(request);
}
