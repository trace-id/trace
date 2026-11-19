# @trace-id/embed

Trace inside your own backend. No separate server, no new database: device identification and fraud signals run in the
app you already have, on the database you already run.

```sh
npm install @trace-id/embed
```

## Three steps

**1. Create Trace once, with your database.**

```ts
import { createTrace } from '@trace-id/embed';
import { mongoStorage } from '@trace-id/embed/mongo';       // or postgresStorage, or memoryStorage for tests

export const trace = createTrace({
  storage: mongoStorage(db),                              // your existing MongoDB Db
  secret: process.env.TRACE_SECRET!,                      // 32+ random characters, kept stable
});
```

**2. Mount one route for the browser SDK** (pick your framework below). It serves `/trace/v1/identify` on your own API.

**3. In the browser, point the SDK at your API; on your server, verify and decide.**

```ts
// browser
const client = createClient({ apiKey: 'pk_embed', endpoint: 'https://api.yourapp.com/trace' });
const { eventId } = await client.get({ linkedId: user.id });

// your signup / login / payment handler: an in-process call, not an HTTP request
const event = await trace.verify(body.eventId);
if (event.suspectScore >= 60) return block();
if (event.signals.multiAccount.detected) flagForReview(event);
```

The browser SDK requires an `apiKey` that starts with `pk_`. Any value works unless you set `publicKey` in
`createTrace`, which then has to match.

## Mount it on your framework

| Framework | Code |
| --- | --- |
| **Express / Connect** | `app.use(toNodeHandler(trace))` from `@trace-id/embed/node` |
| **Fastify** | `registerFastify(app, trace)` from `@trace-id/embed/fastify` |
| **NestJS (Fastify adapter)** | `registerFastify(app.getHttpAdapter().getInstance(), trace)` in `main.ts` |
| **NestJS (Express adapter)** | `app.use(toNodeHandler(trace))` in `main.ts` |
| **Next.js** (route handler) | `app/trace/[...path]/route.ts`: `const h = toFetchHandler(trace); export { h as POST, h as OPTIONS }` |
| **Hono, Bun, Deno, Remix, SvelteKit** | `toFetchHandler(trace)` from `@trace-id/embed/fetch` |
| **Anything else** | `await trace.identify(body, { ip, headers })`, then send `result` as JSON and `setCookie` as a header |

All adapters take `{ prefix }` (default `/trace`). Set your framework's trust-proxy option so the client IP is right.

## Pick your storage

| Database | Code | Notes |
| --- | --- | --- |
| **MongoDB** | `mongoStorage(db, { eventRetentionDays: 90 })` | Seven `trace_` collections (two for the fraud score) with their own indexes. Retention is a TTL index. |
| **Postgres** | `postgresStorage(pool)` | Seven `trace_` tables, created on first use. One transaction per identification. |
| **Memory** | `memoryStorage()` | Tests and local development. Not shared between processes. |
| **Your own** | Implement `TraceStorage` | About 20 small queries. Run `storageContract()` from the source to check it. |

## Counters

The velocity and high-activity signals count events per visitor, IP and account. By default the counts live in your
process. With several instances, share them on your Redis:

```ts
import { redisCounters } from '@trace-id/embed';
createTrace({ storage, secret, counters: redisCounters(redis) });   // an ioredis client; keys prefixed trace:vel
```

## What you can call

| Method | Use |
| --- | --- |
| `trace.verify(eventId)` | The verified event for a decision. Throws `TraceError` 404/410 if unknown or older than the window (60 min). |
| `trace.event(eventId)` | The same, without the window, for your admin. |
| `trace.device(deviceId)` | Every browser and account on a device: multi-accounting, ban evasion. |
| `trace.visitorEvents(visitorId)` | A visitor's history, newest first. |
| `trace.deleteVisitor(visitorId)` | Data requests (also deletes the visitor's fraud labels). |
| `trace.label(eventId, 'payment', true)` | Your verdict for one fraud type: a chargeback (`true`), a review that cleared it (`false`). |
| `trace.unlabel(eventId, label)`, `trace.eventLabels(eventId)` | Undo a label; list an event's labels. |
| `trace.fraudModels()`, `trace.trainFraudModels()` | Models per fraud type with their cross-validated AUC; retrain now. |

**Fraud score.** Once a fraud type has 30 labels (at least 5 fraud and 5 legit), Trace trains a model on which signals
fired and every new event gets `fraudScores: [{ label, probability, reasons }]`. Models retrain 30 s after the last
label change. Same limits as the server: 20 types, newest 50,000 labels per type. A custom adapter without the
optional label methods keeps working; label calls then throw 501. See [the API reference](../../docs/api.md#fraud-score).

`onEvent` in `createTrace` receives every event in-process: push it to your queue, moderation tools or logs instead of
running webhooks.

## Options

`scoring` (weights and thresholds; default `scoring.default.json`), `ipIntel` (Tor, datacenter, VPN, proxy and country: `createIpIntel()` from [`@trace-id/ip-intel`](../ip-intel) combines IP data providers and lists),
`ipStorage` (`truncated` by default, or `full`, `hashed`, `none`), `crossBrowser` (default on), `cookie` (first-party
visitor cookie, default on), `publicKey`, `verifyWindowMinutes`, `sealKey`, `crawlers` (`{ ranges }` from `fetchCrawlerRanges()` verifies AI crawlers by published IP ranges; `false` turns crawler checks off), `fraudScore` (`false` turns it off, or `{ retrainAfterMs }`), `onEvent`, `log`.

## Same engine as the server

The standalone Trace server uses this package's core for matching, tokens and validation, so results are identical,
and it is covered by the same accuracy benchmark. Use the server when you want Trace as its own service with a
dashboard; use `@trace-id/embed` when you want it inside your app.
