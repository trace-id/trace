# Signal catalog

Each signal is defined in [`packages/signals/src/definitions.ts`](../packages/signals/src/definitions.ts) and contributes its weight from [`scoring.default.json`](../scoring.default.json) to the suspect score (0 to 100, capped) when detected. Every event lists the contributing signals in `reasons`.

Phase 1 ships the signals below. VPN detection beyond datacenter ranges, geolocation, developer tools, virtual machine, privacy-focused browser and high-activity device arrive in Phase 2.

| Signal | Default weight | How it is detected | False positives |
| --- | ---: | --- | --- |
| `bot` | 60 | One strong indicator (`navigator.webdriver`, `HeadlessChrome` UA, automation globals from Puppeteer/Playwright/Selenium, the HTTP `User-Agent` differing from the one the page reported) or two weak ones (no plugins on desktop Chromium, empty languages, notification permission inconsistency, missing `window.chrome`, zero outer window size). | Accessibility tools and some privacy extensions trip weak indicators; that is why two are required. |
| `tampering` | 25 | Native functions whose source is not `[native code]`, navigator properties shadowed on the instance, UA platform vs `navigator.platform` mismatch, UA claiming a browser whose features are missing. | Anti-fingerprinting extensions trigger this by design. Treat it as "this browser lies about itself", not as fraud by itself. Canvas noise (Brave, Firefox RFP) is reported in details but does not trigger the signal alone. |
| `tor` | 30 | Request IP in the operator-supplied Tor exit list (`TOR_EXIT_LIST_FILE`). | Exit lists lag reality; a recycled IP may be flagged after it stopped being an exit. |
| `datacenterIp` | 15 | Request IP in an operator-supplied datacenter/hosting CIDR list (`DATACENTER_CIDR_FILE`). Most commercial VPNs exit from such ranges. | Corporate egress through cloud security gateways and iCloud Private Relay can come from hosting ranges. |
| `ipBlocklist` | 40 | Request IP in an operator-supplied blocklist (`IP_BLOCKLIST_FILE`). | Shared IPs (CGNAT, mobile carriers, universities) can put innocent users on a list. |
| `velocity` | 20 | Redis counters over sliding windows: events per visitor per hour, distinct visitors per IP per hour, distinct IPs per visitor per day, distinct visitors per `linkedId` per day. Thresholds in `scoring.default.json`. | Offices, schools and mobile carriers put many real visitors behind one IP. Raise `visitorsPerIp1h` for CGNAT-heavy audiences. Not evaluated (reported as unavailable) without Redis. |
| `incognito` | 5 | Chromium: storage quota below twice the JS heap limit. Firefox: `serviceWorker` hidden in a secure context. Safari: OPFS rejects with "unknown transient reason". | Low-disk devices get small quotas and can look private; browsers change these behaviours between releases. Low weight on purpose. |

## IP lists

The open build never bundles IP data. Lists are plain text, one IP or CIDR per line, `#` comments allowed, IPv4 and IPv6 both supported. Examples of public sources an operator may choose to use (check each source's terms yourself):

- Tor exit list: `https://check.torproject.org/torbulkexitlist`
- Cloud provider ranges published by the providers themselves (AWS `ip-ranges.json`, Google Cloud `cloud.json`, Azure service tags).

Lists are loaded at startup. A pluggable `IpIntelProvider` interface (`apps/server/src/intel/ip-intel.ts`) lets you add GeoIP/ASN or reputation providers.

## Identification components

These feed matching, not the suspect score. Each is hashed in the browser.

| Component | Weight | Reading |
| --- | ---: | --- |
| `canvas` | 3 | 2D canvas render (text, emoji, blending). Omitted when two renders differ (farbling). |
| `webgl` | 3 | Unmasked GPU vendor and renderer. |
| `webglParams` | 2 | WebGL limits and extension list. |
| `audio` | 2 | OfflineAudioContext compressor output. |
| `fonts` | 3 | Installed fonts by text measurement against fallbacks. |
| `screen` | 1.5 | Screen size (orientation-independent), color depth, pixel ratio. |
| `hardware` | 1.5 | CPU cores, device memory, touch points. |
| `timezone` | 1 | IANA timezone. |
| `languages` | 1 | `navigator.languages`. |
| `platform` | 1 | `navigator.platform` and UA-CH platform. |
| `math` | 1 | Floating-point results of transcendental functions. |
| `css` | 0.5 | `CSS.supports` feature bitmap. |
| `media` | 0.5 | Stable media queries (gamut, pointer, hover; not color scheme). |
| `userAgentFamily` | 2 | Browser family and OS, no version. |
