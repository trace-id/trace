# @trace-id/proxy-cloudflare

A Cloudflare Worker that serves Trace from your own domain: `www.example.com/trace/*` is forwarded to your Trace
server. Ad blockers leave your own domain alone, Safari keeps the visitor cookie, and the server sees the real client IP
and, with Cloudflare Bot Management, the JA4 TLS fingerprint.

```ts
// worker.ts
export { default } from '@trace-id/proxy-cloudflare';
```

Worker variables: `UPSTREAM` (your server origin, required), `PREFIX` (default `/trace`), `JA4_HEADER` (default `x-ja4`).
Route `www.example.com/trace/*` to the worker.

Server settings: `TRUST_PROXY` set to Cloudflare's IP ranges, `TLS_FINGERPRINT_HEADER=x-ja4`. The worker rewrites the
visitor cookie path to the prefix itself.

Browser: `createClient({ apiKey, endpoint: 'https://www.example.com/trace', firstPartyCookie: true })`.

For a custom handler, `createProxy({ upstream, prefix, ja4Header })` returns a `(request) => Promise<Response>`.
