# Changelog

All notable changes to Trace. Versions follow [semantic versioning](https://semver.org); while the major version is 0, minor versions may change behaviour.

## 0.1.1 (2026-11-21)

### Added

- **IP providers from the dashboard** (Integrations, IP intelligence; first account only). Add several providers and several keys per provider, spread calls over keys by weight or use them in failover order, set daily limits per key and provider, send only a share of addresses to a provider, set a priority, test a key before saving it, and watch calls, failures, rate limits and timings per provider and per key. Keys are stored encrypted and never shown again. Providers in `IP_PROVIDERS` keep working and are counted. New providers need one registry entry in `@trace-id/ip-intel`.
- **A shared IP cache.** Each provider's answer is cached per address, so an address costs one provider call per cache time, including "nothing known" answers. With Redis the cache is shared between server instances and survives restarts, keyed by a hash so Redis never holds an address. The dashboard shows cache hits against provider calls.
- **Redis from the dashboard** (Integrations, Redis): set or change the address with a connection test, no restart. `REDIS_URL` stays the fallback.
- **Instance settings** in the dashboard for the lookup time budget, the cache time and the shared cache switch.
- **Client package tracking.** Events now record which package sent them. The framework packages (React, Next.js, Vue, Nuxt, Svelte, Angular, Solid) report themselves as `via`, the engine stays `sdk`. The dashboard has a Clients tab (events, visitors, flagged and last seen per package and version) and shows the package on each event. Older SDKs keep working and appear as JavaScript.

- **Team management.** Invite people to a project by email, change roles, remove people, leave a project. An invited address can sign up even when sign-up is closed. A project always keeps an owner.
- **Delete a project** (owners, by typing its name), with everything under it.
- **Allow and block lists** per project: an IP, a range, a visitor, a device or a linked id. Matching events score 100 or 0, the signal score is kept, allow wins. Block and Allow buttons on event and visitor pages.
- **Alerts**: rules on flagged events, the flagged share or event volume, with a cooldown, a history in the dashboard and an optional signed webhook.

### Changed

- A provider that answers "nothing known" for an address is now cached like any other answer; only failed or timed-out calls are retried.
- The Redis connection can be changed at runtime; the shared IP cache is only used while it is connected.

### Database

- New migrations add `instance_settings`, `ip_providers`, `ip_provider_keys`, `ip_provider_usage`, `project_invites`, `list_entries`, `alert_rules` and `alert_events`. They run on start like the others.

## 0.1.0 (2026-11-19)

First public release. **Pre-release software: it has not been validated on real traffic, so do not use it to block users yet.** Start in shadow mode: log the score, review who would have been flagged, then choose thresholds from your own data.

### What is in it

- **Server and dashboard** (AGPL-3.0). Identify, matching, scoring, webhooks, API keys, retention and visitor deletion. A dashboard with an overview, events, visitors, accounts, fraud rings and a relationship graph, a policy simulator for shadow-mode what-ifs, a signal catalogue and data-quality checks.
- **Device identification.** Recognises returning devices through private windows, cleared storage and browser updates, and links browsers on one device. Browser readings are hashed in the browser.
- **26 signals, each with reasons**: bots and AI agents, anti-detect browsers, automated input, VPNs, Tor and proxies, tampering, emulators, multiple accounts on one device and one account on many devices. Every score comes with the reasons behind it, and every signal documents when it can be a false alarm.
- **Embedded mode** (`@trace-id/embed`): run the engine inside your own backend on MongoDB or Postgres.
- **Browser and framework SDKs** (MIT): JavaScript, React, Next.js, Vue, Nuxt, Svelte, Angular, Solid.
- **Mobile SDKs** (MIT): React Native and Expo, Flutter, Kotlin, Swift.
- **Server SDKs** (MIT): Node.js (with Express and Fastify guards), Python (Django, Flask, FastAPI guards), PHP (Laravel middleware), Java, Go, Ruby, .NET, and a WordPress and WooCommerce plugin.
- **First-party proxies** for Cloudflare, Netlify, Vercel and Fastly, so the SDK runs on your own domain.
- **MCP server** so AI assistants can look up events and explain a score, plus an OpenAPI description.
- **Container images** for amd64 and arm64: `ghcr.io/trace-id/trace-server:0.1.0` and `ghcr.io/trace-id/trace-dashboard:0.1.0`.

### Install

```sh
git clone https://github.com/trace-id/trace.git && cd trace
./setup.sh          # Windows PowerShell: .\setup.ps1
```

```sh
npm install @trace-id/sdk-js        # browser
npm install @trace-id/sdk-node      # verify events on your server
pip install trace-device            # Python
```

All npm packages are published with provenance.

### Known limits

- **Accuracy figures are from synthetic data.** They are a regression guard, not a real-world estimate; real accuracy will be lower. See [docs/accuracy.md](docs/accuracy.md).
- **Tested in CI against shared test vectors, but not yet in production apps:** the Ruby, .NET, Go and Java SDKs and the framework guards.
- **Least tested: device-reading layers.** The Swift (`Device.swift`), Android and Flutter glue that reads the device and stores the token needs a real device or SDK to build, so CI covers only the cores, which are checked byte for byte against the TypeScript SDK. Try them in your app first.
- **Edge proxies** (Netlify, Vercel, Fastly) are unit tested but have not been deployed on those platforms.
- **No team management or project deletion** in the dashboard yet, and no alerts or allow and block lists.
- The legal pages on the project website have not had a legal review.
