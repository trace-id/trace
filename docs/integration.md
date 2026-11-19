# Integrating

## Integrations

| Where | Package | Use |
| --- | --- | --- |
| Browser, any framework | `@trace-id/sdk-js` (or the `<script>` file the server hosts at `/sdk/`) | `createClient(...).get()` |
| React | `@trace-id/sdk-react` | `<IdentifyProvider>`, `useVisitorData()` |
| Next.js (App Router) | `@trace-id/sdk-next` | `@trace-id/sdk-next/client` provider and hook; `@trace-id/sdk-next/server` `withTrace()` guard for route handlers |
| Vue 3 | `@trace-id/sdk-vue` | `app.use(createIdentify(...))`, `useVisitorData()` |
| Nuxt 3/4 | `@trace-id/sdk-nuxt` | module in `nuxt.config`, auto-imported `useVisitorData()` |
| Remix, React Router | `@trace-id/sdk-react` | `<IdentifyProvider>`, `useVisitorData()`; verify in an `action` with `guardRequest` |
| Astro | `@trace-id/sdk-js` | a page `<script>` with `createClient(...)`; verify in an endpoint with `guardRequest` |
| Angular 17+ | `@trace-id/sdk-angular` | `provideTrace(...)`, `injectVisitorData()` (signals) |
| Solid, SolidStart | `@trace-id/sdk-solid` | `<IdentifyProvider>`, `createVisitorData()` (signals) |
| Svelte, SvelteKit | `@trace-id/sdk-svelte` | `createVisitorData(...)`: a store with `subscribe`; verify in `+server.ts` with `guardRequest` |
| Android (Kotlin) | `sdks/kotlin` (`dev.trace.device`) | `createTraceClient(context, apiKey, endpoint)`, `trace.get()`; core tested against the TypeScript SDK's payloads, Android glue unverified |
| iOS (Swift, draft) | `sdks/swift` (`TraceDevice`) | `makeTraceClient(apiKey:endpoint:)`, `try await trace.get()`; not yet compiled, tests run in CI on macOS |
| Flutter | `sdks/flutter` (`trace_device`) | `createTraceClient(...)`, `await trace.get()`; core tested against the TypeScript SDK's payloads, device glue unverified |
| Node backend | `@trace-id/sdk-node` | `verifyEvent`, `verifyWebhook`, `unsealEventResult`; guards `traceGuard` (Express, Nest), `traceHook` (Fastify), `guardRequest` (Hono, Remix, Workers) |
| Python backend | `trace-device` (PyPI) | `Client.get_event`, `verify_webhook`, `unseal_event_result`; guards for Django (`trace_device.django`), Flask (`trace_device.flask`) and FastAPI (`trace_device.fastapi`) |
| PHP backend | `trace/trace` (Composer) | `Client::getEvent`, `Client::verifyWebhook`, `Client::unsealEventResult`; `Trace\Guard` and a Laravel middleware (`trace:reject_score=80`) |
| WordPress, WooCommerce | `integrations/wordpress/trace-device` (plugin) | login, registration, comments and checkout checks; starts in shadow mode ([README](../integrations/wordpress/README.md)) |
| Java backend | `io.github.trace-id:trace` (Maven) | `getEvent`, `verifyWebhook`, `unsealEventResult` |
| Ruby backend (draft) | `trace-device` (RubyGems) | `Trace::Client#get_event`, `Trace.verify_webhook`, `Trace.unseal_event_result`, a Rack middleware for Rails |
| .NET backend (draft) | `TraceDevice`, `TraceDevice.AspNetCore` (NuGet) | `TraceClient.GetEventAsync`, `TraceWebhooks.Verify`, `TraceSealed.Unseal`, `UseTraceGuard` middleware |
| Go backend | `github.com/trace-id/trace/sdks/go` | `Client.GetEvent`, `VerifyWebhook`, `UnsealEventResult`, `Guard` middleware for `net/http` |
| Any other backend | REST | `GET /v1/events/:eventId` with `Authorization: Bearer sk_...` ([API](api.md)) |
| First-party proxy | `@trace-id/proxy-cloudflare`, or the nginx/Caddy snippets below | serve the API from your own domain |
| AI assistants (Claude, Cursor) | `@trace-id/mcp` | MCP tools to look up and explain events and devices ([AI agents](../packages/mcp-server/README.md)) |

Every server SDK does the same three things and is tested against the same vectors produced by the server's own code.

## Flow

1. Browser: `const { eventId } = await client.get({ linkedId })` from `@trace-id/sdk-js`.
2. Send `eventId` to your backend with the action you want to protect (signup, login, checkout).
3. Backend: `const event = await verifyEvent(eventId, { secretKey, endpoint, timeoutMs: 1500 })` from `@trace-id/sdk-node`.
4. Decide using `event.suspectScore`, `event.reasons`, `event.visitorId` and your own data.

Never trust a `visitorId` or score that the browser sends you directly.

### Guarding a route

`@trace-id/sdk-node` ships guards that do steps 3 and 4 for you. Each reads the event id from the `x-trace-event-id` header or the JSON body, verifies it with your secret key (`TRACE_SECRET_KEY`, `TRACE_ENDPOINT`, or pass `secretKey` and `endpoint`) and exposes the verified event. You still decide with `reject`.

```ts
// Express or Nest (Express platform), after express.json()
import { traceGuard } from '@trace-id/sdk-node/express';
app.post('/signup', traceGuard({ reject: (e) => e.suspectScore >= 80 }), (req, res) => res.json({ visitor: req.trace?.visitorId }));

// Fastify
import { traceHook } from '@trace-id/sdk-node/fastify';
app.post('/signup', { preHandler: traceHook() }, handler);

// Next.js App Router
import { withTrace } from '@trace-id/sdk-next/server';
export const POST = withTrace(async (request, { event }) => Response.json({ visitor: event?.visitorId }));

// Hono, Remix, SvelteKit, Workers
import { guardRequest } from '@trace-id/sdk-node/web';
const guard = await guardRequest(request);
if (guard.response) return guard.response;
```

```python
# Django, Flask, FastAPI
from trace_device.flask import trace_guard

@app.post('/signup')
@trace_guard(reject=lambda e: e['suspectScore'] >= 80)
def signup(): ...
```

The guard answers 400 for a missing or invalid event, 403 when `reject` returns true, 503 when Trace cannot be reached and 500 for a bad key or missing configuration. Set `failOpen: true` to let requests through (with `event` null) when Trace is unreachable; a bad key never fails open.

## Loading the browser SDK

From npm with a bundler:

```ts
import { createClient } from '@trace-id/sdk-js';
const client = createClient({ apiKey: 'pk_...', endpoint: 'https://id.example.com' });
```

Without a bundler, serve the single-file build from your own domain (`packages/sdk-js/dist/browser/`, about 10 KB gzipped):

```html
<script type="module">
  import { createClient } from '/assets/sdk.esm.js';
  const client = createClient({ apiKey: 'pk_...', endpoint: 'https://id.example.com' });
</script>
<!-- or, classic script: window.Trace.createClient(...) -->
<script src="/assets/sdk.global.js"></script>
```

## Pass your account id

Send your own user id as `linkedId` whenever you know it (sign-in, sign-up, checkout). It powers per-account velocity, `multiAccount` (many accounts on one device), `accountSharing` (one account on many devices) and the device graph (`GET /v1/devices/:deviceId`). Use an internal id, not an email.

```ts
const { eventId } = await client.get({ linkedId: user.id });
```

## First-party mode

Browsers treat a server on another site as third party: ad blockers block it, and Safari caps what scripts store to 7 days. Serving the API from your own site fixes both. Route a path of your site (or a subdomain that resolves to the same infrastructure) to the server, and turn on `firstPartyCookie`:

```ts
const client = createClient({ apiKey: 'pk_...', endpoint: 'https://www.example.com/trace', firstPartyCookie: true });
```

The server then also sets the visitor token as an HttpOnly, `SameSite=Lax` cookie scoped to `/v1/identify`, which scripts cannot read and Safari does not cap when it comes from your own servers. `SameSite=Lax` means the cookie only works same-site; it is never a third-party cookie. Set `TRUST_PROXY` to your proxy so IPs stay correct.

The cookie is scoped to `/v1/identify` on the server; behind a path such as `/trace` the browser sees `/trace/v1/identify`, so either set `VISITOR_COOKIE_PATH=/trace/v1/identify` on the server or let the proxy rewrite the path (shown below). Without one of the two the browser never sends the cookie back.

nginx:

```nginx
location /trace/ {
  proxy_pass http://trace-server:8080/;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Host $host;
  proxy_cookie_path /v1/ /trace/v1/;
}
```

Caddy (no cookie-path rewrite built in, so set `VISITOR_COOKIE_PATH=/trace/v1/identify` on the server):

```
handle_path /trace/* {
  reverse_proxy trace-server:8080
}
```

Cloudflare: deploy `@trace-id/proxy-cloudflare` (`packages/proxy-cloudflare` in the repository) as a Worker on `www.example.com/trace/*` with `UPSTREAM` set to your server. It forwards the real client IP, strips client-sent JA4 headers, passes Cloudflare's JA4 fingerprint (with Bot Management; set `TLS_FINGERPRINT_HEADER=x-ja4` on the server) and rewrites the cookie path.

Netlify, Vercel and Fastly: use `@trace-id/proxy-edge` (`packages/proxy-edge`). Each adapter removes visitor-sent forwarding headers and sets the client IP from the platform (`context.ip` on Netlify, `x-real-ip` on Vercel, `event.client` on Fastly). Set `TRUST_PROXY` on the server to the platform's egress ranges. It is unit tested but not yet deployed on those platforms, so check on the demo that the server sees the real client IP.

```ts
// Netlify: netlify/edge-functions/trace.ts
import { netlifyProxy } from '@trace-id/proxy-edge/netlify';
export default netlifyProxy({ upstream: 'https://id.example.com' });
export const config = { path: '/trace/*' };
```

A plain rewrite also works where you do not need the real IP or JA4 (Vercel `vercel.json`: `{ "rewrites": [{ "source": "/trace/:path*", "destination": "https://id.example.com/:path*" }] }`, Netlify `_redirects`: `/trace/* https://id.example.com/:splat 200`). It cannot rewrite the cookie path, so set `VISITOR_COOKIE_PATH=/trace/v1/identify` on the server.

Add the page origin (`https://www.example.com`) to the public key's allowed origins as usual.

## React

```tsx
import { IdentifyProvider, useVisitorData } from '@trace-id/sdk-react';

<IdentifyProvider apiKey="pk_..." endpoint="https://id.example.com">
  <SignupForm />
</IdentifyProvider>;

function SignupForm() {
  const { getData } = useVisitorData({ immediate: false });
  async function onSubmit(form: FormData) {
    const result = await getData({ linkedId: currentUser.id });
    await fetch('/api/signup', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(form), eventId: result?.eventId }) });
  }
  // ...
}
```

`useVisitorData()` returns `{ data, error, isLoading, getData }`; with `immediate` (the default) it identifies on mount. Errors are typed `IdentifyError`s with a `code`, never thrown from the hook. `useIdentifyClient()` gives the client for consent toggles. Nothing runs during server rendering.

## React Native and Expo

```tsx
import { IdentifyProvider, useVisitorData } from '@trace-id/sdk-react-native';

<IdentifyProvider apiKey="pk_..." endpoint="https://id.example.com">
  <Checkout />
</IdentifyProvider>;
```

Install it with `npx expo install @trace-id/sdk-react-native expo-application expo-crypto expo-device expo-localization expo-secure-store` and add `app:<bundle or application id>` to the public key's allowed origins (a native app sends no `Origin`; it names its app in `X-Trace-App`). The hook and errors are the same as for React. Events from apps carry `app` (platform, model, app version, `isDevice`, `rooted`) and the `emulator` and `rootedDevice` signals. See the [package README](../packages/sdk-react-native/README.md) for what it reads and what it does not.

## Fail open or fail closed

This service must never be the reason your users cannot sign in. Both SDKs use short timeouts and throw typed errors (`IdentifyError`, `VerifyError`) with a `code`. Choose per action:

**Fail open** (recommended for login and signup): if the SDK or verification errors or times out, continue as if no signal were available, and rely on your other defences (rate limits, CAPTCHA, email verification).

```ts
let event = null;
try {
  event = await verifyEvent(eventId, { secretKey, endpoint, timeoutMs: 1500 });
} catch (err) {
  log.warn({ code: (err as VerifyError).code }, 'device check unavailable, continuing');
}
if (event && event.suspectScore >= 80) return challengeOrReject();
```

**Fail closed** (for high-value actions such as payouts): require a verified event and reject or step up to manual review otherwise.

```ts
const event = await verifyEvent(eventId, { secretKey, endpoint, timeoutMs: 3000 }).catch(() => null);
if (!event || event.suspectScore >= 50) return requireManualReview();
```

Either way, treat the score as one input. Start in shadow mode (log only), measure false positives on real users, then enforce.

## Consent

The SDK can start disabled and be enabled by your consent manager:

```ts
const client = createClient({ apiKey, endpoint, enabled: false });
onConsent(() => client.enable());
onWithdraw(() => client.disable(true)); // also deletes the persisted visitor token
```

## Receiving webhooks

Verify against the **raw** body (before JSON parsing), reject failures, and dedupe on `payload.id`:

```ts
import { verifyWebhook, WebhookVerificationError } from '@trace-id/sdk-node/webhooks';

app.post('/hooks/device', express.raw({ type: 'application/json' }), async (req, res) => {
  let payload;
  try {
    payload = verifyWebhook({ body: req.body, signature: req.header('X-Signature'), secret: process.env.WEBHOOK_SECRET });
  } catch (err) {
    return res.status(400).send((err as WebhookVerificationError).code);
  }
  if (await alreadyProcessed(payload.id)) return res.sendStatus(200);
  await handle(payload); // payload.type: 'event.created' | 'visitor.flagged'
  res.sendStatus(200);
});
```

Respond quickly (within 5 s) and do slow work asynchronously; a slow response counts as a failure and is retried. Signatures older than 5 minutes are rejected by default (`toleranceSec`).

## Verification window

Events can be verified for `EVENT_VERIFY_WINDOW_MINUTES` (default 60) after creation, then return `410 event_expired`. Verify promptly; do not store `eventId`s to verify later.
