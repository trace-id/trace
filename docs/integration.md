# Integrating

## Flow

1. Browser: `const { eventId } = await client.get({ linkedId })` from `@tbdname/sdk-js`.
2. Send `eventId` to your backend with the action you want to protect (signup, login, checkout).
3. Backend: `const event = await verifyEvent(eventId, { secretKey, endpoint, timeoutMs: 1500 })` from `@tbdname/sdk-node`.
4. Decide using `event.suspectScore`, `event.reasons`, `event.visitorId` and your own data.

Never trust a `visitorId` or score that the browser sends you directly.

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

## Verification window

Events can be verified for `EVENT_VERIFY_WINDOW_MINUTES` (default 60) after creation, then return `410 event_expired`. Verify promptly; do not store `eventId`s to verify later.
