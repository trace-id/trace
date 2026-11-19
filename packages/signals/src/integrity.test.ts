import { describe, expect, it } from 'vitest';
import { evaluateSignals } from './definitions.js';
import { hashComponent } from './hash.js';
import { checkPayloadIntegrity, derivedComponents, hardwareKey, screenKey } from './integrity.js';
import { TEST_ATTRIBUTES, TEST_SCORING_CONFIG, makeContext, makePayload } from './testing.js';

describe('payload integrity', () => {
  it('passes a payload whose components were derived from its attributes', () => {
    expect(checkPayloadIntegrity(makePayload())).toEqual({
      checked: ['screen', 'timezone', 'languages', 'platform', 'webgl', 'hardware'],
      mismatched: [],
    });
  });

  it('accepts either touch flag, which only the browser can see', () => {
    const p = makePayload();
    p.components.hardware = derivedComponents(TEST_ATTRIBUTES, true).hardware!;
    expect(checkPayloadIntegrity(p).mismatched).toEqual([]);
  });

  it('catches attributes edited after collection', () => {
    const p = makePayload();
    p.attributes = { ...p.attributes, screenWidth: 390, screenHeight: 844, webglRenderer: 'Apple GPU' };
    expect(checkPayloadIntegrity(p).mismatched).toEqual(['screen', 'webgl']);
  });

  it('catches a component replaced by hand, and does not judge one that is left out', () => {
    const p = makePayload();
    delete p.components.timezone;
    p.components.languages = hashComponent('fr-FR');
    const r = checkPayloadIntegrity(p);
    expect(r.mismatched).toEqual(['languages']);
    expect(r.checked).not.toContain('timezone');
  });

  it('flags a component sent for a reading that is empty', () => {
    const p = makePayload({ attributes: { languages: [], webglVendor: null, webglRenderer: null } });
    expect(p.components.languages).toBeUndefined();
    expect(checkPayloadIntegrity(p).mismatched).toEqual([]);
    p.components.languages = hashComponent('en-US');
    expect(checkPayloadIntegrity(p).mismatched).toEqual(['languages']);
  });

  it('builds the keys the SDK hashes', () => {
    expect(screenKey({ ...TEST_ATTRIBUTES, screenWidth: 1080, screenHeight: 1920 })).toBe('1920x1080|24|1');
    expect(screenKey({ ...TEST_ATTRIBUTES, screenWidth: null })).toBeNull();
    expect(hardwareKey(TEST_ATTRIBUTES, false)).toBe('8|8|0|false');
  });
});

describe('tamperedRequest signal', () => {
  it('stays quiet on an honest payload and fires on an edited one', () => {
    expect(evaluateSignals(makeContext(), TEST_SCORING_CONFIG).tamperedRequest.detected).toBe(false);
    const edited = makePayload();
    edited.attributes = { ...edited.attributes, timezone: 'America/New_York' };
    const r = evaluateSignals(makeContext({ payload: edited }), TEST_SCORING_CONFIG).tamperedRequest;
    expect(r).toMatchObject({ detected: true, details: { mismatched: ['timezone'] } });
  });
});
