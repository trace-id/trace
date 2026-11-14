# Privacy guide for operators

Device identification data is personal data under the GDPR and similar laws. You (the operator) are the controller or processor for what this service stores. This page explains what it stores and which controls exist. It is not legal advice.

## What is stored

| Data | Where | Notes |
| --- | --- | --- |
| Hashed signal components | `visitors.signalSummary`, `events.signals` | One-way hashes computed in the browser. Raw canvas, audio and font readings never leave the page. |
| Selected device attributes | `events.signals` | Screen size, timezone, languages, platform, user agent, GPU renderer. Used for signals and shown in event detail. |
| IP address | `events.ip` | Per `IP_STORAGE`: `truncated` by default (/24 IPv4, /48 IPv6), or `full`, `hashed` (keyed HMAC), `none`. |
| Your identifiers | `events.linkedId`, `events.tags` | Whatever you send. Avoid sending emails or names; use internal ids. |
| Velocity counters | Redis | Counts and HyperLogLog sketches keyed by visitor id and hashed IP; expire within 25 hours. |

Nothing leaves your deployment unless you configure an external provider.

## Controls

- **Retention:** per-project `retentionDays` (default 30) and a global cap `RETENTION_MAX_DAYS` (default 90). See [api.md](api.md#retention).
- **Deletion requests:** `DELETE /v1/visitors/:visitorId` removes the visitor and every event for it.
- **Consent:** the browser SDK can start disabled (`enabled: false`) and be enabled by your consent manager; `disable(true)` also deletes the stored visitor token.
- **Minimisation:** keep `IP_STORAGE=truncated` or stricter unless a feature needs full addresses.

## Handling a deletion request

1. Find the visitor id(s). If the request comes from one of your users, look up events by your own `linkedId` (event search arrives with the dashboard; until then keep the `visitorId` from verified events next to your user record).
2. Call `DELETE /v1/visitors/:visitorId` for each id. A `204` confirms deletion; a `404` means nothing is stored.
3. Delete any copies you keep in your own systems.
4. Record that the request was completed.

Backups of the Postgres database keep deleted data until they rotate out; set backup retention accordingly.

## Lawful basis and consent

Whether you need consent depends on your jurisdiction and purpose. In the EU, reading device characteristics generally falls under the ePrivacy rules on terminal equipment, with an exemption only where strictly necessary for a service the user requested; fraud prevention on login or payment is commonly argued under legitimate interest, but take legal advice for your case. A DPA template will be added for review.
