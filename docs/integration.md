# Integrating

## Flow

1. Browser: `const { eventId } = await client.get({ linkedId })` from `@tbdname/sdk-js`.
2. Send `eventId` to your backend with the action you want to protect (signup, login, checkout).
3. Backend: `const event = await verifyEvent(eventId, { secretKey, endpoint, timeoutMs: 1500 })` from `@tbdname/sdk-node`.
4. Decide using `event.suspectScore`, `event.reasons`, `event.visitorId` and your own data.

Never trust a `visitorId` or score that the browser sends you directly.

## Loading the browser SDK

From npm with a bundler:

```ts
import { createClient } from '@tbdname/sdk-js';
const client = createClient({ apiKey: 'pk_...', endpoint: 'https://id.example.com' });
```

Without a bundler, serve the single-file build from your own domain (`packages/sdk-js/dist/browser/`, about 7.5 KB gzipped):

```html
<script type="module">
  import { createClient } from '/assets/sdk.esm.js';
  const client = createClient({ apiKey: 'pk_...', endpoint: 'https://id.example.com' });
</script>
<!-- or, classic script: window.Tbdname.createClient(...) -->
<script src="/assets/sdk.global.js"></script>
```

## React

```tsx
import { IdentifyProvider, useVisitorData } from '@tbdname/sdk-react';

<IdentifyProvider apiKey="pk_..." endpoint="https://id.example.com">
  <SignupForm />
</IdentifyProvider>;

function SignupForm() {
  const { getData } = useVisitorData({ immediate: false });
  async function onSubmit(form: FormData) {
    const result = await getData({ linkedId: form.get('email') as string });
    await fetch('/api/signup', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(form), eventId: result?.eventId }) });
  }
  // ...
}
```

`useVisitorData()` returns `{ data, error, isLoading, getData }`; with `immediate` (the default) it identifies on mount. Errors are typed `IdentifyError`s with a `code`, never thrown from the hook. `useIdentifyClient()` gives the client for consent toggles. Nothing runs during server rendering.

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
import { verifyWebhook, WebhookVerificationError } from '@tbdname/sdk-node/webhooks';

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
