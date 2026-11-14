# Accuracy harness

`npm run accuracy` replays labeled sessions through the real matching engine (`apps/server/src/identification/engine.ts`) using an in-memory candidate store that applies the same update rules as ingest. CI fails when precision or recall drop more than 0.5 points below [`baseline.json`](../apps/server/test/fixtures/accuracy/baseline.json).

## Fixtures

- `apps/server/test/fixtures/accuracy/*.json`: hand-labeled sessions. `acceptance.json` holds the Phase 1 acceptance cases: one device in normal and private windows, a minor browser update with and without the stored token, and lookalike devices with identical hardware that must stay separate.
- Synthetic populations (`apps/server/src/accuracy/synthetic.ts`), generated deterministically from a seed: popularity-skewed GPUs, screens, hardware, timezones and languages; default font sets on most devices; and lifecycle events (return visit, private window, cleared storage, minor and major browser update, external monitor, travel).

A session has a `device` (ground truth: one browser installation), a `profile` (browser storage: same profile means the persisted token is still there) and the hashed `components`.

## Metrics

- **Precision** (pairwise): of all session pairs assigned the same visitor, the share that really are the same device. Low precision means different people get merged, which is the costly error for ban evasion.
- **Recall** (pairwise): of all same-device session pairs, the share assigned the same visitor.
- **False merge rate**: share of devices whose very first session was attached to another device's visitor.
- **Indistinguishable rate**: share of devices whose first-session components exactly equal another device's. No engine can split those; it bounds what is achievable on the fixture.
- **Per scenario**: share of sessions that landed on the device's original visitor.

## Choosing the default threshold

On the synthetic populations, `matchThreshold` was swept from 0.80 to 0.92. At 0.80 precision collapsed (59% and 35%) because GPU-derived components dominate the weights, so lookalike devices that differ only in screen, timezone or language cleared the bar. 0.90 gave the best F1 on both populations while keeping precision high, so it is the default. This was tuned on synthetic data only and must be revisited on real traffic in Phase 3 (shadow mode); tuned weights then go in a private override file, not in this repository.

## Limits

Synthetic data reflects our assumptions about the world. Real traffic has correlations and noise we did not model (browser extensions, OS updates changing fonts, GPU driver updates changing canvas). Expect real-world accuracy to be lower than these numbers.
