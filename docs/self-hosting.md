# Self-hosting guide

The [quickstart](/quickstart) gets a local stack running. This page covers what changes for a real deployment.

## Components

| Service | Image | Needs |
| --- | --- | --- |
| `server` | `apps/server/Dockerfile` | Postgres 14+, optionally Redis 7; runs migrations on start |
| `dashboard` | `apps/dashboard/Dockerfile` | Reaches the server at `API_URL` |
| `postgres` | `postgres:16-alpine` | Persistent volume |
| `redis` | `redis:7-alpine` | No persistence needed (counters and rate limits only) |

The server is stateless apart from Postgres and Redis, so you can run several instances behind a load balancer. Maintenance (retention, partitions) and webhook delivery coordinate through the database, so any number of instances is safe.

## Public URLs and TLS

Put both services behind a reverse proxy that terminates TLS, for example:

- `https://id.example.com` → server (browsers call `/v1/identify` and load `/sdk/*` here; your backend calls `/v1/events`)
- `https://dashboard.example.com` → dashboard

Then set:

| Variable | Value |
| --- | --- |
| `DASHBOARD_URL` (server) | `https://dashboard.example.com`, exactly as users open it. Sessions and CSRF checks depend on it; with `https` the session cookie is `Secure`. |
| `API_URL` (dashboard) | The server's internal address, e.g. `http://server:8080` |
| `TRUST_PROXY` (server) | The proxy's IP or CIDR, e.g. `10.0.0.0/8`. Without it every request appears to come from the proxy, so IP signals and per-IP limits break. Never `true` unless the proxy strips client-sent `X-Forwarded-For`. Hop counts are refused. |

Expose only the reverse proxy. Postgres and Redis must not be reachable from the internet, and in the provided Compose file they are not published.

## Secrets

`TOKEN_SECRET` signs visitor tokens, keys internal IP hashes and encrypts webhook secrets. `AUTH_SECRET` signs dashboard sessions. Use different random values of at least 32 characters, keep them out of version control, and back them up with the database: rotating `TOKEN_SECRET` invalidates visitor tokens (visitors are re-matched by signals) and makes stored webhook secrets unreadable (recreate the endpoints).

## Redis

Without `REDIS_URL` the server runs, but rate limits and velocity-based signals (`velocity`, `highActivity`) are off, and it logs a warning. If Redis fails at runtime, the server fails open and logs at most once a minute.

## IP data

Nothing is bundled. Mount files into the server container and point the variables at them; they are read at startup, so restart after updating them.

- `TOR_EXIT_LIST_FILE`, `DATACENTER_CIDR_FILE`, `IP_BLOCKLIST_FILE`: one IP or CIDR per line.
- `GEOIP_COUNTRY_DB`, `GEOIP_ASN_DB`: MaxMind-format `.mmdb` files you obtained under their own license.
- `DATACENTER_ASN_FILE`: one ASN per line; needs `GEOIP_ASN_DB`.

See the [signal catalog](/signals#ip-intelligence) for sources. Refresh lists on a schedule (daily for Tor).

## Backups

Back up Postgres regularly (`pg_dump` or volume snapshots). Redis needs no backup. Backups contain personal data: give them a retention period that matches your privacy policy, because deleted visitors stay in old backups until those expire.

## Upgrades

Pull the new version and rebuild. The server applies database migrations on start (`prisma migrate deploy`), so start one instance first and wait for it to become healthy before scaling out. Read the release notes for breaking configuration changes.

## Retention and partitions

Events live in monthly Postgres partitions created ahead of time. A maintenance job (at start and every `MAINTENANCE_INTERVAL_MINUTES`) deletes events and inactive visitors older than each project's retention, and drops whole partitions older than `RETENTION_MAX_DAYS`.

## Sizing

A single small instance (1 vCPU, 1 GB) handles typical small-site traffic; the ingest path targets under 150 ms at p95 server-side. Postgres storage grows with events times retention; each event row is a few kilobytes. Start with the defaults and watch Postgres disk and CPU.

## Health checks

- `GET /health`: process is up.
- `GET /health/ready`: Postgres reachable (Redis reported but not required).

## Telemetry

Neither the server nor the dashboard sends anything out. Next.js and Better Auth telemetry are disabled in the build.
