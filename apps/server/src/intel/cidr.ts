import { isIPv4, isIPv6 } from 'node:net';

export interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

function parseV4(ip: string): bigint {
  return ip.split('.').reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

function parseV6(ip: string): bigint {
  let text = ip.split('%')[0] ?? '';
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4Tail?.[1]) {
    const v4 = parseV4(v4Tail[1]);
    text = `${text.slice(0, -v4Tail[1].length)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = tail !== undefined ? [...headParts, ...Array<string>(missing).fill('0'), ...tailParts] : headParts;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(Number.parseInt(g || '0', 16)), 0n);
}

const V4_MAPPED_PREFIX = 0xffffn << 32n;

/** IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is folded to IPv4 so lists match either form. */
export function parseIp(ip: string): ParsedIp | null {
  if (isIPv4(ip)) return { version: 4, value: parseV4(ip) };
  if (isIPv6(ip)) {
    const value = parseV6(ip);
    if (value >> 32n === 0xffffn) return { version: 4, value: value - V4_MAPPED_PREFIX };
    return { version: 6, value };
  }
  return null;
}

interface Range {
  start: bigint;
  end: bigint;
}

export class CidrSet {
  private readonly v4: Range[];
  private readonly v6: Range[];

  private constructor(v4: Range[], v6: Range[]) {
    this.v4 = v4;
    this.v6 = v6;
  }

  get size(): number {
    return this.v4.length + this.v6.length;
  }

  /** Accepts IPs and CIDRs, one per entry; `#` comments and blanks are ignored, junk is skipped. */
  static from(entries: Iterable<string>): CidrSet {
    const v4: Range[] = [];
    const v6: Range[] = [];
    for (const raw of entries) {
      const entry = raw.split('#')[0]?.trim() ?? '';
      if (!entry) continue;
      const [addr = '', bitsText] = entry.split('/');
      const ip = parseIp(addr);
      if (!ip) continue;
      const width = ip.version === 4 ? 32 : 128;
      const mappedV6 = ip.version === 4 && isIPv6(addr);
      let bits = bitsText === undefined ? width : Number(bitsText) - (mappedV6 ? 96 : 0);
      if (!Number.isInteger(bits) || bits < 0 || bits > width) continue;
      bits = Math.trunc(bits);
      const hostBits = BigInt(width - bits);
      const start = (ip.value >> hostBits) << hostBits;
      const end = start + (1n << hostBits) - 1n;
      (ip.version === 4 ? v4 : v6).push({ start, end });
    }
    return new CidrSet(merge(v4), merge(v6));
  }

  static fromText(text: string): CidrSet {
    return CidrSet.from(text.split(/\r?\n/));
  }

  has(ip: string): boolean {
    const parsed = parseIp(ip);
    if (!parsed) return false;
    const ranges = parsed.version === 4 ? this.v4 : this.v6;
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = ranges[mid] as Range;
      if (parsed.value < r.start) hi = mid - 1;
      else if (parsed.value > r.end) lo = mid + 1;
      else return true;
    }
    return false;
  }
}

function merge(ranges: Range[]): Range[] {
  ranges.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: Range[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1n) {
      if (r.end > last.end) last.end = r.end;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}
