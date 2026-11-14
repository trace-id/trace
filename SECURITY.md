# Security policy

This is a security product: a hole here is worse than in an ordinary app. Thank you for reporting responsibly.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the Security tab) once the repository is public. Until then, contact the maintainer privately.

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge within 3 working days and to agree a disclosure date with you.

## Scope

In scope: the server (`apps/server`), the SDKs (`packages/*`), the Docker setup, and the docs where they give unsafe advice.

Especially interesting:

- Reading or altering another project's events or visitors (IDOR, tenant isolation).
- Forging a verified event, a visitor token, or a webhook signature.
- Bypassing origin checks or rate limits in ways that matter beyond what is documented below.
- Leaking keys, raw signals or IPs through logs, errors or responses.
- SSRF, injection, deserialization or denial of service with small requests.

## Known, documented limits (not vulnerabilities)

- A non-browser client can send any `Origin` header. Origin checks stop other websites from using your public key in browsers; rate limits and server-side verification cover the rest.
- Revoked keys keep working for up to 30 seconds per server instance because of the key cache.
- Client-side signals can be spoofed by a determined attacker. They raise the cost of abuse; they are not proof.
- Without Redis, rate limits and velocity signals are off (the server fails open and logs a warning).
- `WEBHOOK_ALLOW_INSECURE=true` turns off webhook SSRF protection. It exists for local development and logs a warning at startup; never set it in production.

## Supported versions

Pre-1.0: only the latest commit on the default branch gets fixes.
