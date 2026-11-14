import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service.js';
import { hashesEqual, hashKey, parseKey, type KeyType } from './key-crypto.js';

export interface ResolvedKey {
  keyId: string;
  projectId: string;
  type: KeyType;
  allowedOrigins: string[];
}

interface CachedRecord {
  hash: string;
  key: ResolvedKey | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 10_000;

/**
 * Caches lookups by prefix for 30 s to keep ingest off the database. Consequence: a revoked
 * key keeps working for up to 30 s per server instance (documented).
 */
@Injectable()
export class KeyService {
  private readonly cache = new Map<string, CachedRecord>();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(key: string, expected: KeyType): Promise<ResolvedKey | null> {
    const parsed = parseKey(key);
    if (!parsed || parsed.type !== expected) return null;
    const presentedHash = hashKey(key);
    const record = await this.lookup(parsed.prefix);
    if (!record.key || !hashesEqual(record.hash, presentedHash)) return null;
    return record.key;
  }

  /** Drops a cached key so a revocation applies on this instance immediately. */
  evict(prefix: string): void {
    this.cache.delete(prefix);
  }

  private async lookup(prefix: string): Promise<CachedRecord> {
    const now = Date.now();
    const cached = this.cache.get(prefix);
    if (cached && cached.expiresAt > now) return cached;

    const row = await this.prisma.apiKey.findUnique({
      where: { prefix },
      select: { id: true, projectId: true, type: true, hash: true, allowedOrigins: true, revokedAt: true },
    });
    const record: CachedRecord =
      row && row.revokedAt === null
        ? {
            hash: row.hash,
            key: { keyId: row.id, projectId: row.projectId, type: row.type, allowedOrigins: row.allowedOrigins },
            expiresAt: now + CACHE_TTL_MS,
          }
        : { hash: '', key: null, expiresAt: now + CACHE_TTL_MS };
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(prefix, record);
    return record;
  }
}
