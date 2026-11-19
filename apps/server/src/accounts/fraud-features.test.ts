import { describe, expect, it } from 'vitest';
import { parseJa4List } from '../intel/tls-intel.js';
import { clearedVisitorCookie, readVisitorCookie, visitorCookie } from '../identify/visitor-cookie.js';
import { countAccounts } from './accounts.service.js';

describe('countAccounts', () => {
  it('has no account context without any linkedId', () => {
    expect(countAccounts({ linkedId: null, deviceId: 'd' }, [], [])).toBeNull();
  });

  it('counts accounts on the device, the current one included', () => {
    expect(countAccounts({ linkedId: 'u1', deviceId: 'd' }, ['u1', 'u2'], [])).toEqual({
      accountsOnDevice: 2,
      devicesForAccount: 1,
    });
    expect(countAccounts({ linkedId: null, deviceId: 'd' }, ['u1', 'u2', 'u3'], [])).toEqual({
      accountsOnDevice: 3,
      devicesForAccount: null,
    });
  });

  it('counts devices of the account by deviceId, falling back to the visitor id', () => {
    const visitors = [
      { id: 'v1', deviceId: 'd' }, // another browser of this device
      { id: 'v2', deviceId: 'e' },
      { id: 'v3', deviceId: null },
    ];
    expect(countAccounts({ linkedId: 'u1', deviceId: 'd' }, [], visitors)).toEqual({
      accountsOnDevice: 1,
      devicesForAccount: 3,
    });
  });
});

describe('visitor cookie', () => {
  const opts = { name: '_trace_vt', secure: true };
  it('is HttpOnly, same-site only and scoped to the identify path', () => {
    expect(visitorCookie('a.b-c_d', opts)).toBe(
      '_trace_vt=a.b-c_d; Path=/v1/identify; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure',
    );
    expect(visitorCookie('t', { name: 'x', secure: false, domain: 'example.com' })).toBe(
      'x=t; Path=/v1/identify; Max-Age=34560000; HttpOnly; SameSite=Lax; Domain=example.com',
    );
    expect(clearedVisitorCookie(opts)).toBe('_trace_vt=; Path=/v1/identify; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
    expect(visitorCookie('t', { ...opts, path: '/trace/v1/identify' })).toContain('Path=/trace/v1/identify;');
  });

  it('reads only a well-formed token under the configured name', () => {
    expect(readVisitorCookie('a=1; _trace_vt=tok.en; b=2', '_trace_vt')).toBe('tok.en');
    expect(readVisitorCookie('_trace_vt=<script>', '_trace_vt')).toBeNull();
    expect(readVisitorCookie('x_trace_vt=tok', '_trace_vt')).toBeNull();
    expect(readVisitorCookie(undefined, '_trace_vt')).toBeNull();
  });
});

describe('parseJa4List', () => {
  it('keeps valid fingerprints, lowercased, and skips comments and junk', () => {
    const list = parseJa4List('# bots\nT13D311000_E8F1E7E78F70_D41AE481755E\nnot-a-ja4\n\nt13d1516h2_8daaf6152771_02713d6af862 # x\n');
    expect([...list]).toEqual(['t13d311000_e8f1e7e78f70_d41ae481755e', 't13d1516h2_8daaf6152771_02713d6af862']);
  });
});
