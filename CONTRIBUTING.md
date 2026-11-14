# Contributing

Thanks for helping. A few rules keep the project trustworthy.

## Ground rules

- **Do not copy proprietary code, signal weights, assets or branding** from commercial device-identification products. Feature parity is a goal; copying is not.
- **Licenses:** SDK packages (`packages/*`) are MIT and may only depend on MIT/BSD/Apache-style packages. The server is AGPL-3.0. Check a dependency's license before adding it, and never bundle data whose license forbids redistribution (for example GeoLite databases).
- **No secrets or real user data** in code, tests or fixtures. Use the documentation IP ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`).
- **Accuracy must not silently drop.** `npm run accuracy` compares against `apps/server/test/fixtures/accuracy/baseline.json`. If your change lowers a number on purpose, update the baseline in the same PR and explain why.

## Code style

- TypeScript strict; no `any` unless unavoidable.
- No barrel `index.ts` files: import from the source file. Package entry points are mapped in `exports`.
- Comments only where the reason is not obvious from the code.
- Pin dependency versions exactly (`.npmrc` sets `save-exact`).

## Adding a signal

1. Define it in `packages/signals/src/definitions.ts` with a title, description and an honest false-positive note.
2. Add its weight to `scoring.default.json` (and `TEST_SCORING_CONFIG`).
3. Add unit tests that cover detection and non-detection.
4. Document it in `docs/signals.md`.

## Adding an endpoint

Every route declares `@Auth('public' | 'secret' | 'none')`; the global guard rejects routes that do not. Add a short comment on the controller naming the attack surface (IDOR, replay, enumeration, DoS) and the mitigation, and e2e tests for the unhappy paths.

## Running checks

```sh
npm install
npm run lint && npm run typecheck && npm run build && npm test && npm run accuracy
```

API e2e tests need a migrated Postgres: set `DATABASE_URL_TEST` (and optionally `REDIS_URL_TEST`).
