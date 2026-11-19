# Trace

Open-source, self-hostable device identification and fraud signals. A page embeds the browser SDK; your server returns a stable `visitorId`, a `deviceId` shared by every browser on the device, a suspect score, and the reasons behind it. Your backend verifies the event before trusting it.

- Recognises returning devices through private windows, cleared storage and browser updates
- Links browsers on one device; finds many accounts on one device and one account on many devices
- 20+ signals with reasons: bots, anti-detect browsers, automated input, VPNs, Tor, TLS mismatches, velocity
- SDKs for the browser (JS, React, Vue, Svelte), React Native and Expo apps, and the server (Node, Python, PHP, Java), an MCP server for AI assistants, OpenAPI
- Runs on your infrastructure: as its own service, or embedded in the backend you already have ([`@trace-id/embed`](docs/embedded.md))

**Status: pre-release.** Not yet validated on real traffic; do not use it to block users yet.

## Quick start

You need Docker.

```sh
git clone <repository-url> trace && cd trace
./setup.sh                 # Windows PowerShell: .\setup.ps1
```

The script creates `docker/.env` with random secrets on the first run, starts Postgres, Redis, the server (`http://localhost:8080`) and the dashboard (`http://localhost:3000`), and waits until they are ready. In the dashboard, create the first account (it becomes the admin), a project, a public key with your page's origin, and a secret key.

In the browser:

```html
<script type="module">
  import { createClient } from 'http://localhost:8080/sdk/sdk.esm.js';
  const trace = createClient({ apiKey: 'pk_...', endpoint: 'http://localhost:8080' });
  const { eventId } = await trace.get({ linkedId: 'your-user-id' });
  // send eventId to your backend with the form
</script>
```

On your server:

```sh
curl -H "Authorization: Bearer sk_..." http://localhost:8080/v1/events/EVENT_ID
```

The response has the verified `visitorId`, `deviceId`, `suspectScore`, `reasons` and every signal with its details. Never decide on what the browser reports; only the verified event counts. See [integration](docs/integration.md) for the SDKs, webhooks, sealed results and first-party mode.

### Or embed it in your backend

No separate server: run the same engine inside the app you already have, on your MongoDB or Postgres.

```ts
import { createTrace } from '@trace-id/embed';
import { mongoStorage } from '@trace-id/embed/mongo';
import { toNodeHandler } from '@trace-id/embed/node';

const trace = createTrace({ storage: mongoStorage(db), secret: process.env.TRACE_SECRET });
app.use(toNodeHandler(trace));                      // the browser SDK posts to /trace/v1/identify
const event = await trace.verify(req.body.eventId); // in your signup handler
```

Express, Fastify, NestJS, Next.js, Hono and more; see [embedded mode](docs/embedded.md).

## How it works

```
Browser (sdk-js) --POST /v1/identify (public key, allowed origin)--> server
                                                                     |  rate limit, IP lists, match, score
                                                                     v
                                                     Postgres (visitors, events)  Redis (velocity, limits)
Your backend --GET /v1/events/:eventId (secret key)--> full event: visitor, device, score, reasons, signals
```

- Signals are hashed in the browser. Raw canvas, audio and font readings never leave the page.
- Matching uses a signed persisted token when available, otherwise probabilistic record linkage: agreement on rare values counts more than on common ones, and volatile traits (browser version) cost less than stable ones (GPU). Settings live in [`scoring.default.json`](scoring.default.json) and can be replaced with a private override (`SCORING_CONFIG_PATH`).

## Accuracy

From `npm run accuracy` with the default configuration:

| Fixture | Devices | Sessions | Precision | Recall |
| --- | ---: | ---: | ---: | ---: |
| acceptance (hand-labelled cases) | 5 | 14 | 100% | 100% |
| synthetic population, seed 1 | 300 | 1,222 | 98.0% | 95.7% |
| synthetic population, seed 2 | 1,000 | 3,922 | 94.5% | 92.5% |

**Synthetic data, not real traffic.** The generator models popular hardware, default font sets, private windows, cleared storage, browser updates, external monitors and travel; it is a regression guard, not a real-world estimate, and real-world accuracy will be lower. CI fails if precision or recall drop. See [docs/accuracy.md](docs/accuracy.md).

## Repository

| Path | What | License |
| --- | --- | --- |
| [`apps/server`](apps/server) | API: NestJS 11 + Fastify 5, Prisma/Postgres, Redis | AGPL-3.0 |
| [`apps/dashboard`](apps/dashboard) | Next.js admin dashboard | AGPL-3.0 |
| [`packages/embed`](packages/embed) | The engine as a library: embed Trace in your own backend (MongoDB, Postgres; Express, Fastify, NestJS, Next.js) | AGPL-3.0 |
| [`packages/sdk-js`](packages/sdk-js) | Browser SDK (npm, or a single-file build the server hosts at `/sdk/`) | MIT |
| [`packages/sdk-react`](packages/sdk-react), [`sdk-next`](packages/sdk-next), [`sdk-vue`](packages/sdk-vue), [`sdk-svelte`](packages/sdk-svelte), [`sdk-angular`](packages/sdk-angular), [`sdk-solid`](packages/sdk-solid), [`sdk-nuxt`](packages/sdk-nuxt) | Framework bindings | MIT |
| [`packages/sdk-react-native`](packages/sdk-react-native) | React Native and Expo SDK | MIT |
| [`packages/ip-intel`](packages/ip-intel) | IP data providers and free lists, combined | MIT |
| [`packages/sdk-node`](packages/sdk-node) | Node server SDK: verify events, webhooks, sealed results | MIT |
| [`sdks/`](sdks) | Server SDKs (Python, PHP, Java, Go, Ruby, .NET), the Flutter SDK and the shared test vectors | MIT |
| [`packages/mcp-server`](packages/mcp-server) | MCP server for AI assistants | MIT |
| [`packages/proxy-cloudflare`](packages/proxy-cloudflare) | First-party proxy Worker | MIT |
| [`packages/proxy-edge`](packages/proxy-edge) | First-party proxy for Netlify, Vercel and Fastly | MIT |
| [`packages/signals`](packages/signals) | Shared types, signal definitions, scoring, matching | MIT |
| [`docker/`](docker), [`setup.sh`](setup.sh) | Self-host stack | AGPL-3.0 |
| [`docs/`](docs) | Reference documentation | CC BY 4.0 |

## Documentation

- [Self-hosting](docs/self-hosting.md) and [configuration](docs/configuration.md)
- [Embedded mode](docs/embedded.md): run Trace inside your own backend
- [Integration](docs/integration.md): every SDK, verification, webhooks, consent, first-party mode
- [API reference](docs/api.md) (every server also serves `GET /openapi.json`)
- [Signal catalog](docs/signals.md), with false-positive notes for each signal
- [Privacy guide](docs/privacy.md) and [security checklist](docs/security-checklist.md)
- [Accuracy](docs/accuracy.md)
- [Contributing](CONTRIBUTING.md), [security policy](SECURITY.md), [releasing](RELEASING.md)

## Development

Requirements: Node 22.12+, npm 10, Postgres 14+, optionally Redis 7.

```sh
npm install
npm run build
cp apps/server/.env.example apps/server/.env    # set DATABASE_URL, TOKEN_SECRET, AUTH_SECRET
(cd apps/server && npx prisma migrate deploy && npm run dev)   # http://localhost:8080
API_URL=http://localhost:8080 npm run dev -w trace-dashboard   # http://localhost:3000

npm run lint && npm run typecheck && npm test
npm run accuracy          # fails if precision or recall drop below the baseline
node sdks/run-tests.mjs   # Python, PHP and Java SDKs
```

## Licensing

SDKs and shared types are MIT so they can be embedded anywhere. The server, the dashboard and the embeddable engine (`@trace-id/embed`) are AGPL-3.0: run them, modify them, host them, but share changes if you offer them as a service. IP intelligence data is never bundled; you mount your own lists or databases. Not affiliated with any commercial device-identification vendor.
