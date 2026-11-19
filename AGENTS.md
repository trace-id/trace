# Working on Trace (for coding agents)

The product is **Trace**. In code and package names it is lowercase `trace` (npm scope `@trace-id/`, env vars `TRACE_*`); the Python package is `trace-device` (import `trace_device`) because `trace` is a standard-library module.

## Layout

| Path | What |
| --- | --- |
| `apps/server` | NestJS 11 on Fastify 5, Prisma 7 (Postgres), Redis optional. Ingest, matching, API, webhooks, maintenance. |
| `apps/dashboard` | Next.js dashboard (project, keys, events, usage). |
| `packages/embed` | The engine as a library (`createTrace`): storage adapters (memory, MongoDB, Postgres), framework adapters (fetch, Node, Fastify), counters. The server imports its pure core from here (`@trace-id/embed/core`). |
| `packages/signals` | Shared types, signal definitions, scoring, cross-browser and linkage matching. No I/O. |
| `packages/sdk-js` | Browser SDK; collectors in `src/collectors`. Size budget enforced by `scripts/bundle.mjs`. |
| `packages/sdk-react`, `sdk-vue`, `sdk-svelte` | Framework bindings over sdk-js. |
| `packages/ip-intel` | IP intelligence: provider adapters (IPQualityScore, ipinfo, MaxMind, Spur and others), the combiner (time budget, per-IP cache, never fails identify) and the free-data downloader. Used by the server and `@trace-id/embed` users. |
| `packages/sdk-react-native` | React Native and Expo SDK: device readings through Expo modules, same provider and hook as sdk-react. React Native and Expo are optional peers, typed by `src/native-modules.d.ts`, so the monorepo never installs them (their engines exclude Node 25). |
| `packages/sdk-node` | Node server SDK (verify events, webhooks, sealed results). |
| `packages/mcp-server` | MCP server (`trace-mcp`), JSON-RPC over stdio, no MCP SDK dependency. |
| `packages/proxy-cloudflare` | First-party proxy Worker. |
| `packages/proxy-edge` | First-party proxy for Netlify Edge, Vercel Edge and Fastly Compute (same behaviour as the Cloudflare Worker). |
| `sdks/{python,php,java}` | Server SDKs in other languages, tested against `sdks/test-vectors/vectors.json`. |
| `docs` | Reference Markdown (self-hosting, configuration, API, signals, integration, privacy, security, accuracy), read on GitHub and synced into the website. Keep links relative (`signals.md#x`). |
| `scoring.default.json` | Default weights and thresholds; validated by `apps/server/src/config/scoring.ts`. |

## Commands

```sh
npm install
npx turbo run build typecheck lint      # everything; add --concurrency=1 if the dashboard races
npm run test -w @trace-id/signals        # any workspace: signals, sdk-js, sdk-node, sdk-react, sdk-vue, sdk-svelte, mcp, ...
npm run accuracy                        # identification accuracy; fails on regression against the baseline
node sdks/run-tests.mjs                 # Python, PHP and Java SDKs (skips missing toolchains)
node sdks/test-vectors/generate.mjs     # after changing the sealed or webhook format
```

Server tests that need Postgres read `DATABASE_URL_TEST`; without it the end-to-end suites are skipped. Give the tests their own database: if a running Trace server uses the same one, its webhook worker claims the tests' deliveries and they fail intermittently with `secret_unreadable`.

On Windows, run vitest from a path that starts with an uppercase `C:\`. A lowercase `c:\` cwd (as Git Bash produces) loads two copies of the tooling and fails with "Cannot read properties of undefined (reading 'config')".

## Rules

- Never push to a remote. Commit only when asked.
- Do not copy Fingerprint's (or any vendor's) code, weights, assets or branding. Public documentation as a feature list is fine.
- No secrets, real keys or real user data in the repo or fixtures. Test keys must be obviously fake.
- Every signal ships with a definition in `packages/signals/src/definitions.ts`, a unit test and a false-positive note in `docs/signals.md`. Scores always come with reasons.
- New payload fields are optional, and new scoring fields have defaults, so older SDKs and older override files keep working.
- Never trust client-sent values for decisions; only the server-verified event counts.
- Browser collectors must not prompt for permissions, make network requests or read devices, files or location. Raw high-entropy readings are hashed in the browser.
- Keep the browser SDK within its gzip budget; the build fails otherwise.
- Changes to matching must not regress `npm run accuracy`; raise the baseline only with a measured improvement and say so.
- Do not overstate accuracy: synthetic numbers are labelled as synthetic.
