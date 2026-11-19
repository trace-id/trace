import { createEdgeProxy, type EdgeProxyOptions } from './index.js';

interface NetlifyContext {
  ip?: string;
}

/**
 * Netlify Edge Function, `netlify/edge-functions/trace.ts`:
 *
 *     import { netlifyProxy } from '@trace-id/proxy-edge/netlify';
 *     export default netlifyProxy({ upstream: 'https://id.example.com' });
 *     export const config = { path: '/trace/*' };
 *
 * The client IP is Netlify's `context.ip`, which the visitor cannot set.
 */
export function netlifyProxy(options: Omit<EdgeProxyOptions<NetlifyContext>, 'clientIp' | 'ja4'>) {
  return createEdgeProxy<NetlifyContext>({ ...options, clientIp: (_req, ctx) => ctx?.ip });
}
