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

## Coming later in Phase 2

Signed webhooks, management API for the dashboard (keys, origins, retention, usage, event search).
