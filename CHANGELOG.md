# Changelog

All notable changes to Trace. Versions follow [semantic versioning](https://semver.org); while the major version is 0, minor versions may change behaviour.

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
