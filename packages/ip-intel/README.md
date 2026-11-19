# @trace-id/ip-intel

IP intelligence for Trace: country, ASN, location and Tor, VPN, proxy, datacenter, relay and blocklist flags, combined
from IP data providers and local lists. The Trace server uses it through `IP_PROVIDERS`
([settings](../../docs/configuration.md#ip-data-providers)); in your own app, pass it to `@trace-id/embed`.

```ts
import { createIpIntel, ipqualityscore, cdnHeaders } from '@trace-id/ip-intel';
import { createTrace } from '@trace-id/embed';

const ipIntel = createIpIntel({
  sources: [ipqualityscore({ key: process.env.IPQS_KEY! }), cdnHeaders({ countryHeader: 'cf-ipcountry' })],
  timeoutMs: 400, // one budget for all remote lookups of an IP
  cacheTtlMs: 24 * 3_600_000, // per-IP cache
  onError: (source, err) => console.warn(source, err),
});

const trace = createTrace({ storage, secret, ipIntel });
```

## Providers

`ipqualityscore`, `ipinfo` (Core or Lite), `maxmind` (Insights, City or Country web service), `spur`, `ipdata`,
`ipapiIs`, `ip2locationIo`, `ipregistry`, `proxycheck`, `abuseipdb`, `ipgeolocation`, `ipApi`, and `cdnHeaders` for the
country header your CDN sets. Each takes its key and an optional `fetch`. `providersFromEnv(process.env)` builds them
from the same variables the server reads.

Every adapter has a pure mapper (`mapIpqs`, `mapSpur`, ...) from the provider's documented JSON to Trace's fields, so
you can check what a response turns into. A flag is reported only when the provider's plan returns it: absent means
"not checked", never "no".

## Your own source

```ts
const mine: IpIntelSource = {
  name: 'my-reputation-api',
  remote: true, // cached and time-limited; false for in-memory sources
  async lookup(ip, { signal }) {
    const r = await fetch(`https://rep.example.com/${ip}`, { signal }).then((x) => x.json());
    return { vpn: r.vpn, proxy: r.proxy, country: r.cc };
  },
};
```

## Guarantees

- **Never fails an identification.** A provider that errors or times out leaves its fields "not checked" for that
  event, and the gap is not cached, so the next request tries again.
- **Only the IP is sent,** and never a private or reserved address. Providers are processors of personal data: have a
  data processing agreement and name them in your privacy policy.
- **Merging:** sources in priority order; for country, ASN and location the first that answers wins; a flag is true
  when any source says so.

## Free data files

`downloadIpData({ dir })` from `@trace-id/ip-intel/download` fetches the Tor Project's exit relays, the ranges AWS, Google
Cloud, Oracle Cloud, DigitalOcean and Linode publish, Apple's iCloud Private Relay ranges and DB-IP Lite databases
(CC BY 4.0), plus MaxMind GeoLite2 with your account. The server wraps it as `npm run ip-data -w trace-server -- <dir>`.
