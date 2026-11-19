# @trace-id/proxy-edge

Serve Trace from your own domain on Netlify Edge, Vercel Edge or Fastly Compute: `www.example.com/trace/*` is forwarded to your Trace server. For Cloudflare use [`@trace-id/proxy-cloudflare`](../proxy-cloudflare).

Every adapter removes visitor-sent forwarding headers and the JA4 header, then sets the client IP from what the platform itself provides. The server must trust the platform: set `TRUST_PROXY` to its egress ranges, otherwise the forwarded IP is ignored.

```ts
// Netlify: netlify/edge-functions/trace.ts
import { netlifyProxy } from '@trace-id/proxy-edge/netlify';
export default netlifyProxy({ upstream: 'https://id.example.com' });
export const config = { path: '/trace/*' };
```

```ts
// Vercel: app/trace/[...path]/route.ts
import { vercelProxy } from '@trace-id/proxy-edge/vercel';
const handler = vercelProxy({ upstream: 'https://id.example.com' });
export { handler as GET, handler as POST, handler as OPTIONS };
export const runtime = 'edge';
```

```ts
// Fastly Compute
import { fastlyProxy } from '@trace-id/proxy-edge/fastly';
addEventListener('fetch', fastlyProxy({ upstream: 'https://id.example.com' }));
```

Browser: `createClient({ apiKey, endpoint: 'https://www.example.com/trace', firstPartyCookie: true })`.

Status: logic and header handling are unit tested against fake requests. Not yet deployed on the three platforms; the places to check first are the Netlify `context.ip`, Vercel `x-real-ip` / `x-vercel-ja4-digest` (plan dependent) and Fastly `event.client.tlsJA4` names, and Fastly backend setup.
