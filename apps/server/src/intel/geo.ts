import { readFileSync } from 'node:fs';
import { type IpLocation, toLocation } from '@trace-id/signals/geo';
import { type AsnResponse, type CityResponse, type CountryResponse, Reader } from 'mmdb-lib';

export interface GeoResult {
  country: string | null;
  asn: number | null;
  asnOrg: string | null;
  /** City-level location; only from a City edition database. Optional: added later. */
  location?: IpLocation | null;
}

/** Country and ASN for an IP. Implementations must be synchronous and in-memory. */
export interface GeoLookup {
  lookup(ip: string): GeoResult;
}

export const NO_GEO: GeoLookup = { lookup: () => ({ country: null, asn: null, asnOrg: null }) };

/**
 * Reads operator-supplied MaxMind-format databases (.mmdb): a Country or City database and
 * an ASN database, both optional. Nothing is bundled: GeoLite2 and similar databases have
 * licenses that forbid redistribution, so each operator downloads and mounts their own.
 */
export class MmdbGeoLookup implements GeoLookup {
  constructor(
    private readonly country: Reader<CountryResponse & Partial<CityResponse>> | null,
    private readonly asn: Reader<AsnResponse> | null,
  ) {}

  static fromFiles(countryDb: string | undefined, asnDb: string | undefined): GeoLookup {
    if (!countryDb && !asnDb) return NO_GEO;
    return new MmdbGeoLookup(
      countryDb ? new Reader<CountryResponse & Partial<CityResponse>>(readFileSync(countryDb)) : null,
      asnDb ? new Reader<AsnResponse>(readFileSync(asnDb)) : null,
    );
  }

  lookup(ip: string): GeoResult {
    let country: string | null = null;
    let asn: number | null = null;
    let asnOrg: string | null = null;
    let location: IpLocation | null = null;
    try {
      const c = this.country?.get(ip);
      country = (c?.country?.iso_code ?? c?.registered_country?.iso_code ?? null)?.slice(0, 2) ?? null;
      // City editions add these; a Country edition leaves them out and the location stays null.
      if (c?.location || c?.city) {
        const sub = c.subdivisions?.[0];
        location = toLocation({
          city: c.city?.names?.en ?? null,
          region: sub?.iso_code ?? sub?.names?.en ?? null,
          latitude: c.location?.latitude ?? null,
          longitude: c.location?.longitude ?? null,
          accuracyRadiusKm: c.location?.accuracy_radius ?? null,
          timezone: c.location?.time_zone ?? null,
        });
      }
    } catch {
      country = null;
    }
    try {
      const a = this.asn?.get(ip);
      asn = typeof a?.autonomous_system_number === 'number' ? a.autonomous_system_number : null;
      asnOrg = a?.autonomous_system_organization?.slice(0, 200) ?? null;
    } catch {
      asn = null;
    }
    return { country, asn, asnOrg, location };
  }
}

/** One ASN per line, with or without the "AS" prefix; `#` comments allowed. */
export function parseAsnList(text: string): Set<number> {
  const out = new Set<number>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:AS)?(\d{1,10})\s*(?:#.*)?$/i.exec(raw);
    if (m?.[1]) out.add(Number(m[1]));
  }
  return out;
}
