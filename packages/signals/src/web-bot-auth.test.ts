import { describe, expect, it } from 'vitest';
import { checkSignatureTiming, jwkThumbprintInput, parseSignatureAgent, parseWebBotAuth, signatureBase } from './web-bot-auth.js';

const input = 'sig1=("@authority" "signature-agent");created=1735689600;expires=1735693200;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";nonce="abc";tag="web-bot-auth"';
const headers = (h: Record<string, string>) => (n: string) => h[n] ?? null;

describe('parseWebBotAuth', () => {
  it('reads the labelled signature with tag web-bot-auth', () => {
    const p = parseWebBotAuth(input, 'sig1=:dGVzdA==:');
    expect(p).toMatchObject({
      label: 'sig1',
      components: ['@authority', 'signature-agent'],
      params: { created: 1735689600, expires: 1735693200, alg: 'ed25519', tag: 'web-bot-auth', nonce: 'abc' },
      signature: 'dGVzdA==',
    });
    expect(p!.paramsRaw).toBe(input.slice('sig1='.length));
  });

  it('picks the web-bot-auth member among several and ignores others', () => {
    const multi = `other=("@method");created=1;keyid="x";tag="something", ${input}`;
    expect(parseWebBotAuth(multi, 'other=:AAAA:, sig1=:dGVzdA==:')?.label).toBe('sig1');
    expect(parseWebBotAuth('other=("@method");created=1;keyid="x"', 'other=:AAAA:')).toBeNull();
  });

  it('returns null without both headers, or with component parameters it does not support', () => {
    expect(parseWebBotAuth(input, null)).toBeNull();
    expect(parseWebBotAuth(null, 'sig1=:dGVzdA==:')).toBeNull();
    expect(parseWebBotAuth('sig1=("signature-agent";key="a");created=1;keyid="k";tag="web-bot-auth"', 'sig1=:dGVzdA==:')).toBeNull();
  });
});

describe('parseSignatureAgent', () => {
  it('accepts a quoted https URL or a dictionary member, and returns the origin', () => {
    expect(parseSignatureAgent('"https://chatgpt.com"')).toBe('https://chatgpt.com');
    expect(parseSignatureAgent('agent1="https://agent.example/dir"')).toBe('https://agent.example');
  });
  it('rejects http and credentials', () => {
    expect(parseSignatureAgent('"http://chatgpt.com"')).toBeNull();
    expect(parseSignatureAgent('"https://u:p@chatgpt.com"')).toBeNull();
    expect(parseSignatureAgent('not a url')).toBeNull();
  });
});

describe('checkSignatureTiming', () => {
  const now = 1735690000;
  it('accepts a current signature', () => {
    expect(checkSignatureTiming({ created: now - 10, expires: now + 600, keyid: 'k' }, now)).toBeNull();
  });
  it('rejects expired, future, overlong, unkeyed and non-Ed25519 signatures', () => {
    expect(checkSignatureTiming({ created: now - 900, expires: now - 300, keyid: 'k' }, now)).toBe('expired');
    expect(checkSignatureTiming({ created: now + 600, expires: now + 900, keyid: 'k' }, now)).toBe('created_in_future');
    expect(checkSignatureTiming({ created: now, expires: now + 90_000, keyid: 'k' }, now)).toBe('validity_too_long');
    expect(checkSignatureTiming({ created: now, expires: now + 60 }, now)).toBe('missing_keyid');
    expect(checkSignatureTiming({ created: now, expires: now + 60, keyid: 'k', alg: 'rsa-pss-sha512' }, now)).toBe('unsupported_alg');
    expect(checkSignatureTiming({ keyid: 'k' }, now)).toBe('missing_timestamps');
  });
});

describe('signatureBase', () => {
  it('reproduces the RFC 9421 Appendix B.2.6 signature base', () => {
    const paramsRaw = '("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"';
    const parsed = { label: 'sig-b26', components: ['date', '@method', '@path', '@authority', 'content-type', 'content-length'], params: {}, paramsRaw, signature: '' };
    const h = headers({ date: 'Tue, 20 Apr 2021 02:07:55 GMT', 'content-type': 'application/json', 'content-length': '18' });
    expect(signatureBase(parsed, { method: 'POST', url: 'https://example.com/foo?param=Value&Pet=dog', header: h })).toBe(
      [
        '"date": Tue, 20 Apr 2021 02:07:55 GMT',
        '"@method": POST',
        '"@path": /foo',
        '"@authority": example.com',
        '"content-type": application/json',
        '"content-length": 18',
        `"@signature-params": ${paramsRaw}`,
      ].join('\n'),
    );
  });

  it('builds a Web Bot Auth base and refuses one that leaves out @authority or the Signature-Agent header', () => {
    const p = parseWebBotAuth(input, 'sig1=:dGVzdA==:')!;
    const req = { method: 'GET', url: 'https://shop.example:8443/checkout', header: headers({ 'signature-agent': '"https://chatgpt.com"' }) };
    expect(signatureBase(p, req)).toBe(`"@authority": shop.example:8443\n"signature-agent": "https://chatgpt.com"\n"@signature-params": ${p.paramsRaw}`);
    expect(signatureBase({ ...p, components: ['signature-agent'] }, req)).toBeNull();
    expect(signatureBase({ ...p, components: ['@authority'] }, req)).toBeNull();
    expect(signatureBase({ ...p, components: ['@authority', 'x-missing'] }, { ...req, header: headers({}) })).toBeNull();
  });
});

describe('jwkThumbprintInput', () => {
  it('serialises the required members in lexicographic order', () => {
    expect(jwkThumbprintInput({ kty: 'OKP', crv: 'Ed25519', x: 'abc' })).toBe('{"crv":"Ed25519","kty":"OKP","x":"abc"}');
    expect(jwkThumbprintInput({ kty: 'EC', crv: 'P-256', x: 'abc' })).toBeNull();
  });
});
