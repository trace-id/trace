# Roadmap

What Trace does not do yet, roughly in the order we plan to build it. Trace is pre-release; nothing here is promised by a date.

The list came from comparing Trace with the feature sets of commercial fraud and identity services. Trace already covers device identification, bot, network and anti-detect signals, multi-account detection, scores with reasons, webhooks, server SDKs and the MCP server; the gaps are mostly in turning a score into a decision.

## Next

1. **Rules: allow, challenge or deny.** A rules engine that returns an action with every event, not only a score. Conditions on score, signals, event type, lists and counters. New rules start in **test mode**: they record what they would have done, and you can review those events before switching the rule on.
2. **Event types.** `login`, `signup`, `transaction`, `password_reset`, `profile_update` and custom actions, each `attempted`, `succeeded` or `failed`, sent with the identify call or from the backend. This unlocks the counters and scores below.
3. **Lists.** Block and allow lists for devices, visitors, accounts, emails, email domains and IP ranges, usable from rules and managed from the dashboard and API. Today only an IP blocklist exists.
4. **Counters for failed logins and credential stuffing.** Velocity per IP, per account and per device for each event type, for example "more than 10 failed logins from this IP in 10 minutes".

## Then

5. **Email intelligence.** Disposable and free-mail domains, invalid MX records, random-looking and plus-addressed patterns, and many accounts sharing one email pattern.
6. **Separate scores.** Account takeover, account abuse (fake and multiple accounts) and bot scores, each with its own reasons, alongside the overall suspect score.
7. **AI browser agent detection, beyond declared agents.** Done: a `botInfo` verdict on every event, the `aiAgent` signal, and Web Bot Auth (RFC 9421) verification for signed agents, also usable on any route through `@trace-id/sdk-node/agents`. Next: recognise undeclared agentic browsers from behaviour, and verify the key directory's own signature.
8. **IP lookup API.** Look up the reputation, network and VPN, Tor and hosting status of any IP address, without an identify call.

## Dashboard and operations

9. **Event search and investigation.** Search events by visitor, device, account, IP, signal and score; see an account's or device's full history in one place.
10. **Review queue (case management).** Events a rule sends for review land in a queue; reviewers mark them good or bad, and those outcomes feed weight tuning.
11. **Alerts.** Slack and email alerts on rules or spikes.
12. **Teams.** Invite members with roles, single sign-on, and enforced two-factor authentication.
13. **Sandbox projects and test tokens.** Separate test environments and fixed test results for CI.

## SDKs

14. **More server SDKs:** Go, Ruby and .NET.
15. **Mobile SDKs:** React Native and Expo done (`@trace-id/sdk-react-native`: install-id matching, `emulator`, `rootedDevice`). Next: native iOS and Android SDKs for the signals that need native code.

## Signals still missing (from a comparison with commercial device-intelligence products)

Web, can be built on the current architecture:

16. **Proxy.** Done: the `proxy` signal from an operator-supplied list (`PROXY_CIDR_FILE`). Also done: thirteen IP data providers (`IP_PROVIDERS`: IPQualityScore, Spur, MaxMind, ipinfo and others) for live VPN and residential-proxy reputation, and `npm run ip-data` for free lists with automatic reload.
17. **Rare device.** Done on the server (`rareDevice`). Next: component statistics in the embedded storage adapters.
18. **IP geolocation detail.** Done: `ip.location` with a proximity `zone`. Also done: `flaggedNetwork`, for visitors on a network where other visitors were flagged recently.
19. **Raw device attributes.** Done: `rawAttributes` on every event (18 plain readings).
20. **Tampered request.** Done: `tamperedRequest` recomputes six components from the payload's own readings. Next: detect replayed payloads.
21. **Good-bot verification.** Done for search engines by reverse DNS (`identity: verified`). Next: published IP ranges for AI crawlers.

Emulator and rooted or jailbroken devices are done (React Native SDK). Still needs native code (item 15): cloned apps, Frida, factory reset, active call, location spoofing, and VPN on mobile.

Machine learning:

22. ~~**Fraud score from your labels.**~~ Done: label events per fraud type (`PUT /v1/events/:id/labels/:label`); Trace trains a logistic regression per type on the fired signals and adds `fraudScores` (probability plus reasons) to new events, with a cross-validated AUC per model. The dashboard has a Fraud score page (models, tested accuracy, label progress) and Fraud/Legit buttons on each event. The Python, PHP and Java SDKs can label events too. The embedded library has it too (`trace.label()`, all three storage adapters). Models also use context features (new visitor, weak match, shared IP or account, several accounts per device, bursts, local night). Account age is in too (`newAccount`, `newDeviceForAccount`). AI crawlers and agents are verified against their operators' published IP ranges (`CRAWLER_RANGES_FILE`).
