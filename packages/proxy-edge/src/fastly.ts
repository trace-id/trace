import { createEdgeProxy, type EdgeProxyOptions } from './index.js';

interface FetchEventLike {
  request: Request;
  client?: { address?: string; tlsJA4?: string };
  respondWith(response: Response | Promise<Response>): void;
}

/**
 * Fastly Compute (JavaScript). The client address comes from the platform's `event.client`:
 *
 *     import { fastlyProxy } from '@trace-id/proxy-edge/fastly';
 *     addEventListener('fetch', fastlyProxy({ upstream: 'https://id.example.com' }));
 *
 * Fastly may need the upstream declared as a backend in fastly.toml.
 */
export function fastlyProxy(options: Omit<EdgeProxyOptions<FetchEventLike>, 'clientIp' | 'ja4'>) {
  const proxy = createEdgeProxy<FetchEventLike>({
    ...options,
    clientIp: (_req, event) => event?.client?.address,
    ja4: (_req, event) => event?.client?.tlsJA4,
  });
  return (event: FetchEventLike) => event.respondWith(proxy(event.request, event));
}
