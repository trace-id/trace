import { makePayload } from '@tbdname/signals/testing';
import { describe, expect, it } from 'vitest';
import { parseIdentifyRequest } from './identify.schema.js';

const valid = () => ({
  signals: { ...makePayload(), components: { canvas: 'a'.repeat(28), timezone: 'b'.repeat(28) } },
  sdk: { name: '@tbdname/sdk-js', version: '0.1.0' },
});

describe('identify request schema', () => {
  it('accepts a well-formed request', () => {
    const r = parseIdentifyRequest({ ...valid(), linkedId: 'user-1', tags: { page: 'signup', n: 1, ok: true } });
    expect(r.ok).toBe(true);
  });

  it('rejects unknown fields at every level', () => {
    expect(parseIdentifyRequest({ ...valid(), visitorId: 'forged' }).ok).toBe(false);
    const nested = valid();
    (nested.signals.bot as unknown as Record<string, unknown>).extra = true;
    expect(parseIdentifyRequest(nested).ok).toBe(false);
  });

  it('rejects unknown component names and non-hash values', () => {
    const a = valid();
    (a.signals.components as Record<string, string>).rawCanvas = 'a'.repeat(28);
    expect(parseIdentifyRequest(a).ok).toBe(false);
    const b = valid();
    b.signals.components.canvas = 'data:image/png;base64,AAAA';
    expect(parseIdentifyRequest(b).ok).toBe(false);
  });

  it('caps strings, arrays and tag counts', () => {
    const longUa = valid();
    longUa.signals.attributes.userAgent = 'x'.repeat(513);
    expect(parseIdentifyRequest(longUa).ok).toBe(false);
    const tags = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`t${i}`, i]));
    expect(parseIdentifyRequest({ ...valid(), tags }).ok).toBe(false);
    expect(parseIdentifyRequest({ ...valid(), linkedId: 'a\nb' }).ok).toBe(false);
  });

  it('reports field paths but never values', () => {
    const r = parseIdentifyRequest({ ...valid(), token: '<script>alert(1)</script>' });
    expect(r).toEqual({ ok: false, message: 'Invalid fields: token' });
  });
});
