# tbdname

> Working name. The final name is not chosen yet; `tbdname` is a placeholder used everywhere so it can be renamed in one pass.

Open-source, self-hostable device identification and fraud signals. A page embeds the browser SDK, which collects device signals and sends them to your server. The server returns a stable `visitorId`, a suspect score, and the reasons behind that score. Your backend then verifies the event server-side before trusting it.

**Status: Phase 1 (spike).** Identification, verification, a first signal set and an accuracy harness work end to end. Webhooks, the dashboard, the React SDK, retention jobs and the full signal catalog come in Phase 2. Do not use this in production yet.

## How it works

```
Browser (sdk-js) --POST /v1/identify (public key, allowed origin)--> server
                                                                     |  rate limit, IP lists, match, score
                                                                     v
                                                     Postgres (visitors, events)  Redis (velocity, limits)
Your backend (sdk-node) --GET /v1/events/:eventId (secret key)--> full event: visitor, score, reasons, signals
```

- The browser gets only `{ eventId, visitorId, confidence, suspectScore }`. **Never trust those values** on your server: a client can forge them. Send the `eventId` to your backend and call `verifyEvent`.
- Signals are hashed in the browser. Raw canvas, audio and font readings never leave the page.
- Matching uses a signed persisted token when available, otherwise weighted similarity against candidate visitors found through indexed signal buckets. Weights and thresholds live in [`scoring.default.json`](scoring.default.json) and can be replaced with a private override file (`SCORING_CONFIG_PATH`).

## Accuracy (measured, not claimed)

Numbers from `npm run accuracy`, default config:

| Fixture | Devices | Sessions | Precision | Recall |
| --- | ---: | ---: | ---: | ---: |
| acceptance (hand-labeled Phase 1 cases) | 5 | 14 | 100% | 100% |
| synthetic population, seed 1 | 300 | 1,222 | 96.0% | 90.0% |
| synthetic population, seed 2 | 1,000 | 3,922 | 88.9% | 89.2% |

Precision and recall are pairwise: of the session pairs we put on the same visitor, how many were the same device; and of the same-device pairs, how many we joined. **These are synthetic data, not real traffic.** The synthetic generator models popular hardware, default font sets, incognito, cleared storage, browser updates, external monitors and travel, but it is a regression guard, not a real-world estimate. Expect real-world accuracy to be well below commercial services. Real numbers will be published after the Phase 3 shadow-mode trial. See [docs/accuracy.md](docs/accuracy.md).

## Repository

| Path | What | License |
| --- | --- | --- |
| [`packages/signals`](packages/signals) | Shared payload types, signal definitions, scoring helpers | MIT |
| [`packages/sdk-js`](packages/sdk-js) | Browser SDK | MIT |
| [`packages/sdk-node`](packages/sdk-node) | Server helper: `verifyEvent` | MIT |
| [`apps/server`](apps/server) | NestJS 11 + Fastify 5 API, Prisma/Postgres, Redis | AGPL-3.0 |
| [`docker/`](docker) | Self-host Compose stack | AGPL-3.0 |
| [`docs/`](docs) | Documentation | CC BY 4.0 |
| [`examples/demo`](examples/demo) | Demo page and fake customer backend | MIT |

## Run it locally

Requirements: Node 22.12+, npm 10, Postgres 14+ and optionally Redis 7 (without Redis, rate limits and velocity are off and the server logs a warning).

```sh
npm install
npm run build

# Server
cp apps/server/.env.example apps/server/.env   # set DATABASE_URL, TOKEN_SECRET
cd apps/server
npx prisma migrate deploy
npm run keys:create -- --project demo --origins http://localhost:5173
npm run dev                                     # http://localhost:8080
cd ../..

# Demo page (another terminal)
PUBLIC_KEY=pk_... SECRET_KEY=sk_... npm run demo  # http://localhost:5173
```

Or with Docker:

```sh
cp docker/.env.example docker/.env               # fill in POSTGRES_PASSWORD and TOKEN_SECRET
docker compose -f docker/compose.yml up --build -d
docker compose -f docker/compose.yml exec server \
  node dist/scripts/create-keys.js --project demo --origins http://localhost:5173
```

## Development

```sh
npm run lint
npm run typecheck
npm test          # API e2e tests run when DATABASE_URL_TEST points at a migrated database
npm run accuracy  # fails if precision or recall drop below test/fixtures/accuracy/baseline.json
```

## Documentation

- [API reference](docs/api.md)
- [Signal catalog](docs/signals.md), with false-positive notes for each signal
- [Integrating: fail open vs fail closed](docs/integration.md)
- [Accuracy harness](docs/accuracy.md)
- [Security policy](SECURITY.md) and [contributing](CONTRIBUTING.md)

## Licensing

SDKs and shared types are MIT so they can be embedded anywhere. The server is AGPL-3.0: run it, modify it, host it, but share changes to the server if you offer it as a service. IP intelligence data is never bundled; you mount your own lists or databases. This project is not affiliated with any commercial device-identification vendor.
