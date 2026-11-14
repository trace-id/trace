# Configuration reference

All configuration is through environment variables, validated at startup. Invalid values stop the server with a message naming the variable (never its value).

## Server: required

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `TOKEN_SECRET` | 32+ random characters. Signs visitor tokens, keys IP hashes, encrypts webhook secrets. |
| `AUTH_SECRET` | 32+ random characters, different from `TOKEN_SECRET`. Signs dashboard sessions. |

## Server: network and dashboard

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address. |
| `PORT` | `8080` | Listen port. |
| `DASHBOARD_URL` | `http://localhost:3000` | Public URL of the dashboard. Used for sessions and CSRF checks. |
| `DASHBOARD_ALLOW_SIGNUP` | `false` | Allow sign-ups after the first account. |
| `TRUST_PROXY` | `false` | `false`, `true`, or a comma list of proxy IPs/CIDRs. |
| `REQUEST_TIMEOUT_MS` | `10000` | Per-request timeout. |
| `REDIS_URL` | unset | Redis for rate limits and velocity. Optional. |
| `DB_STATEMENT_TIMEOUT_MS` | `5000` | Postgres statement timeout per connection. |
| `DB_POOL_MAX` | `10` | Postgres connections per server process. |

## Server: data and privacy

| Variable | Default | Description |
| --- | --- | --- |
| `IP_STORAGE` | `truncated` | How IPs are stored on events: `full`, `truncated` (/24, /48), `hashed`, `none`. |
| `EVENT_VERIFY_WINDOW_MINUTES` | `60` | How long `GET /v1/events/:id` accepts an event. |
| `RETENTION_MAX_DAYS` | `90` | Upper bound for any project's retention; whole partitions older than this are dropped. |
| `MAINTENANCE_INTERVAL_MINUTES` | `360` | How often retention and partition upkeep run. |
| `SCORING_CONFIG_PATH` | bundled `scoring.default.json` | Replace weights and thresholds with your own file. |

## Server: IP intelligence

| Variable | Description |
| --- | --- |
| `TOR_EXIT_LIST_FILE` | Tor exit IPs, one per line. |
| `DATACENTER_CIDR_FILE` | Hosting/cloud ranges, one IP or CIDR per line. |
| `IP_BLOCKLIST_FILE` | Your blocklist, one IP or CIDR per line. |
| `GEOIP_COUNTRY_DB` | MaxMind-format Country or City `.mmdb`. |
| `GEOIP_ASN_DB` | MaxMind-format ASN `.mmdb`. |
| `DATACENTER_ASN_FILE` | Hosting ASNs, one per line (needs `GEOIP_ASN_DB`). |

## Server: rate limits (per minute)

| Variable | Default |
| --- | --- |
| `RATE_LIMIT_INGEST_PER_KEY_PER_MIN` | `1200` |
| `RATE_LIMIT_INGEST_PER_IP_PER_MIN` | `60` |
| `RATE_LIMIT_INGEST_PER_VISITOR_PER_MIN` | `30` |
| `RATE_LIMIT_API_PER_KEY_PER_MIN` | `600` (also used per dashboard user) |

## Server: webhooks

| Variable | Default | Description |
| --- | --- | --- |
| `WEBHOOK_TIMEOUT_MS` | `5000` | Per-attempt timeout. |
| `WEBHOOK_POLL_INTERVAL_MS` | `1000` | How often the worker looks for due deliveries. |
| `WEBHOOK_ALLOW_INSECURE` | `false` | Development only: allow `http://` and private-network targets. Never in production. |

## Dashboard

| Variable | Default | Description |
| --- | --- | --- |
| `API_URL` | `http://localhost:8080` | Server address the dashboard forwards `/api/auth` and `/v1` to. Read at request time. |
| `PORT` | `3000` | Listen port (Docker image). |

## Docker Compose (`docker/.env`)

`POSTGRES_PASSWORD`, `TOKEN_SECRET` and `AUTH_SECRET` are required. Optional: `POSTGRES_USER`, `POSTGRES_DB`, `SERVER_PORT`, `DASHBOARD_PORT`, `DASHBOARD_URL`, `TRUST_PROXY`, `IP_STORAGE`, `EVENT_VERIFY_WINDOW_MINUTES`.

## Scoring file

`scoring.default.json` holds identification weights and thresholds, suspect-score weights per signal, and velocity thresholds. Copy it, change values, and point `SCORING_CONFIG_PATH` at the copy; the server validates it at startup and refuses unknown keys. The [accuracy harness](/accuracy) can evaluate a candidate file: `npm run accuracy -w tbdname-server -- --config /absolute/path/to/file.json`.
