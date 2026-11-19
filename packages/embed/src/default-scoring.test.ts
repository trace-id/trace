import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from './config.js';
import { DEFAULT_SCORING_RAW } from './default-scoring.js';

describe('bundled default scoring', () => {
  it('matches scoring.default.json at the repository root', () => {
    const file = fileURLToPath(new URL('../../../scoring.default.json', import.meta.url));
    expect(DEFAULT_SCORING_RAW).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  });

  it('validates, with the bot weight at its default', () => {
    expect(DEFAULT_SCORING.suspect.weights.bot).toBe(60);
    expect(DEFAULT_SCORING.identification.method).toBe('linkage');
  });
});
