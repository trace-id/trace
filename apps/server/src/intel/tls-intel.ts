import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { isJa4 } from '@trace-id/signals/tls';
import { type TlsInfo } from '@trace-id/signals/types';
import { ENV, type Env } from '../config/env.js';

/** One JA4 per line; '#' starts a comment. Malformed lines are skipped. */
export function parseJa4List(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim().toLowerCase();
    if (line && isJa4(line)) out.add(line);
  }
  return out;
}

/**
 * TLS fingerprints come from a proxy in front of this server (nginx with a JA4 module, HAProxy, Cloudflare Workers,
 * and similar); the server never sees the handshake itself. Clients can send the header too, so the proxy must
 * overwrite it on every request.
 */
@Injectable()
export class TlsIntelService {
  private readonly blocklist: ReadonlySet<string>;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.blocklist = env.JA4_BLOCKLIST_FILE ? parseJa4List(readFileSync(env.JA4_BLOCKLIST_FILE, 'utf8')) : new Set();
  }

  get headerName(): string | null {
    return this.env.TLS_FINGERPRINT_HEADER ?? null;
  }

  /** Null when the feature is off or the header is missing or malformed. */
  read(headerValue: string | null): TlsInfo | null {
    if (!this.headerName || !headerValue) return null;
    const ja4 = headerValue.trim().toLowerCase();
    if (!isJa4(ja4)) return null;
    return { ja4, blocklisted: this.blocklist.has(ja4) };
  }
}
