import { describe, expect, it } from 'vitest';
import { newVisitorId } from '../common/ids.js';
import { issueToken, verifyToken } from './token.js';

const SECRET = 'x'.repeat(40);
const NOW = new Date('2026-11-14T00:00:00Z');

describe('visitor token', () => {
  const visitorId = newVisitorId();
  const token = issueToken(SECRET, 'project-a', visitorId, NOW);

  it('round-trips', () => {
    expect(verifyToken(SECRET, 'project-a', token, NOW)).toBe(visitorId);
  });

  it('is bound to the project and the secret', () => {
    expect(verifyToken(SECRET, 'project-b', token, NOW)).toBeNull();
    expect(verifyToken('y'.repeat(40), 'project-a', token, NOW)).toBeNull();
  });

  it('rejects a swapped visitor id', () => {
    const forged = token.replace(visitorId, newVisitorId());
    expect(verifyToken(SECRET, 'project-a', forged, NOW)).toBeNull();
  });

  it('expires after 400 days and rejects far-future tokens', () => {
    expect(verifyToken(SECRET, 'project-a', token, new Date(NOW.getTime() + 401 * 86_400_000))).toBeNull();
    const future = issueToken(SECRET, 'project-a', visitorId, new Date(NOW.getTime() + 3_600_000));
    expect(verifyToken(SECRET, 'project-a', future, NOW)).toBeNull();
  });

  it('rejects junk', () => {
    for (const junk of [undefined, '', 'v1', 'v1.a.b.c', `${token}x`]) {
      expect(verifyToken(SECRET, 'project-a', junk, NOW)).toBeNull();
    }
  });
});
