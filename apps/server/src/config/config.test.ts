import { TEST_SCORING_CONFIG } from '@tbdname/signals/testing';
import { describe, expect, it } from 'vitest';
import { parseEnv, parseTrustProxy } from './env.js';
import { loadScoringConfig, parseScoringConfig } from './scoring.js';

describe('scoring config', () => {
  it('finds and validates scoring.default.json by walking up from cwd', () => {
    expect(loadScoringConfig(undefined, process.cwd())).toEqual(TEST_SCORING_CONFIG);
  });

  it('rejects unknown components, unknown keys and out-of-range thresholds', () => {
    const bad = (patch: (c: Record<string, unknown>) => void) => {
      const c = structuredClone(TEST_SCORING_CONFIG) as unknown as Record<string, unknown>;
      patch(c);
      return () => parseScoringConfig(c);
    };
    expect(bad((c) => ((c.identification as Record<string, unknown>).buckets = [['nope']]))).toThrow(/buckets/);
    expect(bad((c) => (c.extra = 1))).toThrow();
    expect(bad((c) => ((c.identification as Record<string, unknown>).matchThreshold = 2))).toThrow(/matchThreshold/);
  });
});

describe('env', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', TOKEN_SECRET: 'x'.repeat(32), AUTH_SECRET: 'y'.repeat(32) };

  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(8080);
    expect(env.IP_STORAGE).toBe('truncated');
    expect(env.EVENT_VERIFY_WINDOW_MINUTES).toBe(60);
  });

  it('names invalid variables without echoing secrets', () => {
    expect(() => parseEnv({ ...base, TOKEN_SECRET: 'short-secret' })).toThrow(/TOKEN_SECRET/);
    expect(() => parseEnv({ ...base, TOKEN_SECRET: 'short-secret' })).not.toThrow(/short-secret/);
  });

  it('parses TRUST_PROXY forms', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('10.0.0.0/8, 192.0.2.1')).toEqual(['10.0.0.0/8', '192.0.2.1']);
    expect(() => parseTrustProxy('2')).toThrow(/hop counts/);
  });
});
