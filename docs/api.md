# API reference (v1)

All endpoints are under `/v1`, speak JSON, and return errors as:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

`429` responses always carry `Retry-After` (seconds). Resources that belong to another project return `404`, the same as resources that do not exist.

## Keys

| Key | Prefix | Where | Can call |
| --- | --- | --- | --- |
| Public | `pk_` | Browser | `POST /v1/identify`, only from the key's allowed origins |
| Secret | `sk_` | Your server only | `GET /v1/events/:eventId` |

Keys are 40 random base62 characters after the prefix, stored as SHA-256 hashes, shown once at creation. Allowed origins are exact (`https://app.example.com`, `http://localhost:5173`) or a subdomain wildcard (`https://*.example.com`, which does not match the apex).

## POST /v1/identify

Called by `sdk-js`. Key in the query string (`?apiKey=pk_...`) so the browser can send a CORS "simple request" with `Content-Type: text/plain` and skip the preflight. `application/json` is accepted too.

Request (all objects reject unknown fields; body capped at 64 KB):

```json
{
  "signals": { "v": 1, "components": { "canvas": "<28 hex>", "...": "..." }, "attributes": {}, "bot": {}, "tamper": {}, "privacy": {}, "storage": {}, "collectMs": 41 },
  "token": "v1....",
  "linkedId": "your-user-id",
  "tags": { "page": "signup" },
  "sdk": { "name": "@tbdname/sdk-js", "version": "0.1.0" }
}
```

Response:

```json
{ "eventId": "0192f0c4-...", "visitorId": "Vx3...", "confidence": 0.97, "suspectScore": 5, "token": "v1...." }
```

The response is deliberately small. Do not make decisions on it; verify the `eventId` on your server.

Errors: `400 invalid_request`, `401 invalid_api_key`, `403 origin_not_allowed`, `413 payload_too_large`, `415 unsupported_media_type`, `429 rate_limited`.

**Attack surface:** DoS (body cap, per-key, per-IP and per-visitor limits), key abuse (origin check; non-browser clients can forge `Origin`, hence limits and server-side verification), forgery (small response, verdict only via the secret key), token replay (HMAC bound to the project and must agree with the device's signals).

## GET /v1/events/:eventId

Header: `Authorization: Bearer sk_...`. Returns the full event:

```json
{
  "eventId": "...",
  "visitorId": "...",
  "confidence": 0.97,
  "matchKind": "token | similar | new",
  "suspectScore": 90,
  "reasons": [{ "signal": "bot", "contribution": 60 }, { "signal": "tor", "contribution": 30 }],
  "signals": { "bot": { "detected": true, "details": {} }, "tor": { "detected": true, "details": {} } },
  "components": { "canvas": "<hash>" },
  "attributes": { "screenWidth": 1920, "screenHeight": 1080, "timezone": "Europe/Berlin", "languages": ["en-US"], "platform": "Win32", "userAgent": "..." },
  "ip": { "address": "198.51.100.0", "country": null, "asn": null },
  "tags": { "page": "signup" },
  "linkedId": "your-user-id",
  "createdAt": "2026-11-14T10:00:00.000Z",
  "expiresAt": "2026-11-14T11:00:00.000Z"
}
```

`ip.address` follows the operator's `IP_STORAGE` setting (`truncated` by default: /24 for IPv4, /48 for IPv6).

Errors: `400 invalid_event_id`, `401 invalid_api_key`, `404 not_found`, `410 event_expired` (older than `EVENT_VERIFY_WINDOW_MINUTES`, default 60), `429 rate_limited`.

**Attack surface:** IDOR (lookup scoped to the key's project), enumeration (UUIDv7 ids with 74 random bits, identical 404s), replay (410 after the window), DoS (per-key limit).

## GET /health, GET /health/ready

No auth. `/health` is liveness. `/health/ready` checks Postgres and reports Redis (`{ "status": "ok", "redis": true }`); Redis being down does not fail readiness because the service degrades without it.

## GET /v1/visitors/:visitorId

Header: `Authorization: Bearer sk_...`. Query: `limit` (1 to 50, default 20), `cursor` (from the previous page's `nextCursor`). Events are newest first.

```json
{
  "visitorId": "Vx3...",
  "firstSeenAt": "2026-11-01T09:00:00.000Z",
  "lastSeenAt": "2026-11-14T10:00:00.000Z",
  "eventCount": 12,
  "events": [
    { "eventId": "...", "createdAt": "...", "matchKind": "token", "confidence": 0.99, "suspectScore": 0, "linkedId": "user-1", "tags": null }
  ],
  "nextCursor": "MjAyNi0xMS0x..."
}
```

Errors: `400 invalid_visitor_id | invalid_cursor | invalid_request`, `401`, `404 not_found`, `429`.

## DELETE /v1/visitors/:visitorId

Header: `Authorization: Bearer sk_...`. Permanently deletes the visitor, its matching buckets and all its events. Returns `204`, or `404` if the visitor does not exist in this project. Velocity counters in Redis hold no personal data (counts and HyperLogLog sketches keyed by the visitor id) and expire within 25 hours.

**Attack surface (both visitor routes):** IDOR (scoped to the key's project; identical 404s), enumeration (119-bit random ids), DoS (per-key limit, max page 50, keyset pagination).

## Retention

Events older than the project's `retentionDays` (default 30, capped by `RETENTION_MAX_DAYS`, default 90) are deleted, and so are visitors not seen within that window. Whole monthly partitions older than `RETENTION_MAX_DAYS` are dropped. The job runs at startup and every `MAINTENANCE_INTERVAL_MINUTES` (default 360); a lease row keeps it to one instance at a time.

## Webhooks

Manage endpoints with the secret key. At most 10 per project.

`POST /v1/webhooks` with `{ "url": "https://hooks.example.com/x", "events": ["event.created", "visitor.flagged"], "flagThreshold": 70 }` returns `201` with the endpoint and its signing `secret` (`whsec_...`). **The secret is shown only once.** `visitor.flagged` fires when an event's `suspectScore` is at or above `flagThreshold` (default 70).

`GET /v1/webhooks` lists endpoints (no secrets). `DELETE /v1/webhooks/:id` removes one (`204` or `404`).

Each delivery is a `POST` with a JSON body:

```json
{ "id": "<delivery id>", "type": "event.created", "createdAt": "...", "data": { "...": "same shape as GET /v1/events/:eventId" } }
```

Headers: `X-Webhook-Id` (same as `id`, stable across retries), `X-Webhook-Timestamp`, and `X-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. Verify with `verifyWebhook` from `@tbdname/sdk-node/webhooks` (see [integration.md](integration.md#receiving-webhooks)).

Delivery: at-least-once. Any 2xx within 5 s counts as delivered. Otherwise retried after 10 s, 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h, then marked dead. Redirects are not followed. Finished deliveries are purged after 7 days; deleting a visitor deletes its deliveries.

**Attack surface:** SSRF (https only; credentials, fragments and private, loopback, link-local, metadata, CGNAT, NAT64 and 6to4 targets refused at registration and re-checked against every resolved address at connect time, which defeats DNS rebinding; no redirects; 64 KB response cap; 5 s timeout), IDOR (scoped by project), abuse (10 endpoints per project, per-key rate limit), secret exposure (encrypted at rest with AES-256-GCM, shown once). `WEBHOOK_ALLOW_INSECURE=true` disables the http and private-network checks for local development only.

## Management API (dashboard sessions)

Used by the dashboard. Authentication is a Better Auth session cookie, not an API key. The dashboard proxies `/api/auth/*` and `/v1/*` to the server so the cookie is first-party on the dashboard's origin (`DASHBOARD_URL`).

Accounts: email and password (12 to 128 characters). The first account can always be created; after that `POST /api/auth/sign-up/email` returns `403` unless `DASHBOARD_ALLOW_SIGNUP=true`. Sign-in: `POST /api/auth/sign-in/email`. Sessions last 7 days.

Roles per project: `owner` (creator), `admin`, `viewer`. Viewers can read; changes need `admin` or above. Users who are not members get `404` for every project route.

| Route | Role | What |
| --- | --- | --- |
| `GET /v1/me` | signed in | User and their projects with roles |
| `POST /v1/projects` `{ name }` | signed in | Create a project (you become owner; max 50) |
| `GET /v1/projects/:projectId` | viewer | Project |
| `PATCH /v1/projects/:projectId` `{ name?, retentionDays? }` | admin | Update; `retentionDays` capped by `RETENTION_MAX_DAYS` |
| `GET /v1/projects/:projectId/keys` | viewer | Keys by prefix (never the full key) |
| `POST /v1/projects/:projectId/keys` `{ type, name?, allowedOrigins? }` | admin | Create; full `key` returned once (max 20 active) |
| `PATCH /v1/projects/:projectId/keys/:keyId` `{ name?, allowedOrigins? }` | admin | Rename, change origins (public keys) |
| `POST /v1/projects/:projectId/keys/:keyId/revoke` | admin | Revoke; immediate on the instance that served the call, within 30 s elsewhere |
| `GET /v1/projects/:projectId/usage?days=30` | viewer | Per-day events, new visitors, events with score >= 70 (UTC days, max 90) |
| `GET /v1/projects/:projectId/events` | viewer | Search: `linkedId`, `visitorId`, `minScore`, `from`, `to` (ISO), `cursor`, `limit` (max 50) |
| `GET /v1/projects/:projectId/events/:eventId` | viewer | Full event; no verification window |
| `GET /v1/projects/:projectId/visitors/:visitorId` | viewer | Visitor history |
| `DELETE /v1/projects/:projectId/visitors/:visitorId` | admin | Privacy deletion |
| `GET`/`POST /v1/projects/:projectId/webhooks`, `DELETE .../webhooks/:id` | viewer / admin | Webhook endpoints |
| `GET /v1/projects/:projectId/webhooks/:id/deliveries` | viewer | Last 50 delivery attempts |

**Attack surface:** CSRF (writes require `Origin` equal to `DASHBOARD_URL`; cookies are `SameSite=Lax`, `Secure` when the dashboard is https), IDOR (membership checked before any handler runs; non-members get 404), privilege escalation (role ranks enforced per route; unknown body fields rejected so roles cannot be set through updates), account abuse (sign-up closed after the first account by default; Better Auth rate-limits auth routes), key disclosure (shown once, stored hashed).
