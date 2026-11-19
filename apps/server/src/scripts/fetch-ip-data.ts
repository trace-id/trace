/**
 * Downloads free IP data (Tor exits, cloud provider ranges, iCloud Private Relay, DB-IP Lite) into a folder and prints
 * the settings to point the server at. Run it daily from cron; the server picks up changed files within 10 minutes.
 *
 *   npm run ip-data -w trace-server -- /data/ip            # defaults
 *   npm run ip-data -w trace-server -- /data/ip --city     # DB-IP City (60 MB) instead of Country: adds ip.location
 *   npm run ip-data -w trace-server -- /data/ip --x4b-vpn  # also a community VPN list (no license stated; check it)
 *
 * With MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY set, MaxMind GeoLite2 is downloaded as well.
 */
import { join } from 'node:path';
import { type DataSource, downloadIpData } from '@trace-id/ip-intel/download';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) ?? 'ip-data';
const accountId = process.env.MAXMIND_ACCOUNT_ID;
const licenseKey = process.env.MAXMIND_LICENSE_KEY;
const maxmind = accountId && licenseKey ? { accountId, licenseKey, edition: args.includes('--city') ? ('GeoLite2-City' as const) : ('GeoLite2-Country' as const) } : undefined;
const sources: DataSource[] = ['tor', 'datacenter', 'relay', 'dbip', ...(maxmind ? (['geolite2'] as const) : []), ...(args.includes('--x4b-vpn') ? (['x4b-vpn'] as const) : [])];

const result = await downloadIpData({ dir, sources, dbipCity: args.includes('--city'), ...(maxmind ? { maxmind } : {}), log: (m) => console.log(m) });

// GeoLite2 (when downloaded) is listed after DB-IP, so its files win for the same setting.
const settings = new Map<string, string>();
for (const w of result.written) settings.set(w.setting, w.file);
console.log('\nAdd to the server environment:');
for (const [setting, file] of settings) console.log(`${setting}=${join(file)}`);
if (result.written.some((w) => w.file.includes('dbip-'))) console.log('\nDB-IP Lite is CC BY 4.0: credit "IP data by DB-IP (db-ip.com)" where you show location data.');
if (result.failed.length > 0) {
  console.error(`\nFailed: ${result.failed.map((f) => `${f.source} (${f.reason})`).join('; ')}`);
  process.exit(result.written.length === 0 ? 1 : 0);
}
