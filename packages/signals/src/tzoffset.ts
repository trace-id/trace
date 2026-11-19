const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    } catch {
      f = null;
    }
    if (formatters.size < 1000) formatters.set(timeZone, f);
  }
  return f;
}

/** UTC offset of an IANA time zone at a given instant, in minutes east of UTC; null for an unknown zone. */
export function timezoneOffsetMinutes(timeZone: string, at: Date): number | null {
  const f = formatterFor(timeZone);
  if (!f) return null;
  try {
    const parts: Record<string, number> = {};
    for (const p of f.formatToParts(at)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
    const local = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
    const utc = Math.floor(at.getTime() / 1000) * 1000;
    const minutes = Math.round((local - utc) / 60_000);
    return Number.isFinite(minutes) ? minutes : null;
  } catch {
    return null;
  }
}
