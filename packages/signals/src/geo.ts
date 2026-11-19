/**
 * IP geolocation helpers. Pure.
 *
 * Proximity: a geohash cell of the IP's approximate location. Devices that keep showing up in the same cell are near each
 * other (or behind the same network). IP geolocation is city-level at best, so the cell is coarse on purpose.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash. Precision 4 is a cell of roughly 39 x 20 km. */
export function geohash(latitude: number, longitude: number, precision = 4): string {
  let latRange: [number, number] = [-90, 90];
  let lonRange: [number, number] = [-180, 180];
  let out = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (out.length < precision) {
    const range = even ? lonRange : latRange;
    const value = even ? longitude : latitude;
    const mid = (range[0] + range[1]) / 2;
    if (value >= mid) {
      ch = (ch << 1) | 1;
      if (even) lonRange = [mid, range[1]];
      else latRange = [mid, range[1]];
    } else {
      ch <<= 1;
      if (even) lonRange = [range[0], mid];
      else latRange = [range[0], mid];
    }
    even = !even;
    if (++bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

export interface IpLocation {
  city: string | null;
  /** ISO 3166-2 subdivision code without the country prefix, e.g. "C" for Cairo, or its name when there is no code. */
  region: string | null;
  /** Rounded to 2 decimals (about 1 km): it is an estimate for the network, not the person. */
  latitude: number | null;
  longitude: number | null;
  /** The database's own uncertainty, in km. */
  accuracyRadiusKm: number | null;
  /** IANA time zone of the location, e.g. "Africa/Cairo". */
  timezone: string | null;
  /** Geohash cell (precision 4) for proximity: devices in the same cell are near each other. */
  zone: string | null;
}

export const NO_LOCATION: IpLocation = { city: null, region: null, latitude: null, longitude: null, accuracyRadiusKm: null, timezone: null, zone: null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Builds the stored location from database fields, dropping anything out of range. */
export function toLocation(input: { city?: string | null; region?: string | null; latitude?: number | null; longitude?: number | null; accuracyRadiusKm?: number | null; timezone?: string | null }): IpLocation {
  const lat = typeof input.latitude === 'number' && Math.abs(input.latitude) <= 90 ? input.latitude : null;
  const lon = typeof input.longitude === 'number' && Math.abs(input.longitude) <= 180 ? input.longitude : null;
  const has = lat !== null && lon !== null;
  return {
    city: input.city?.slice(0, 100) ?? null,
    region: input.region?.slice(0, 100) ?? null,
    latitude: has ? round2(lat) : null,
    longitude: has ? round2(lon) : null,
    accuracyRadiusKm: typeof input.accuracyRadiusKm === 'number' && input.accuracyRadiusKm >= 0 ? Math.round(input.accuracyRadiusKm) : null,
    timezone: input.timezone?.slice(0, 64) ?? null,
    zone: has ? geohash(lat, lon, 4) : null,
  };
}
