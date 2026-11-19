import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWebBotAuth, signatureBase } from '@trace-id/signals/web-bot-auth';
import { createAgentVerifier } from './agents.js';

const NOW = 1_735_690_000_000;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string };
const keyid = createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`).digest('base64url');

/** Signs a request the way a Web Bot Auth agent does. */
function signed(url: string, opts: { agent?: string; created?: number; expires?: number; key?: string } = {}) {
  const created = opts.created ?? Math.floor(NOW / 1000) - 5;
  const expires = opts.expires ?? created + 300;
  const agentHeader = `"${opts.agent ?? 'https://chatgpt.com'}"`;
  const signatureInput = `sig1=("@authority" "signature-agent");created=${created};expires=${expires};keyid="${opts.key ?? keyid}";alg="ed25519";tag="web-bot-auth"`;
  const headers: Record<string, string> = { 'signature-agent': agentHeader, 'signature-input': signatureInput, signature: 'sig1=:AA==:' };
  const parsed = parseWebBotAuth(signatureInput, headers.signature)!;
  const base = signatureBase(parsed, { method: 'GET', url, header: (n) => headers[n] ?? null })!;
  headers.signature = `sig1=:${sign(null, Buffer.from(base), privateKey).toString('base64')}:`;
  return headers;
}

function directoryFetch(calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(url);
    if (url !== 'https://chatgpt.com/.well-known/http-message-signatures-directory') return new Response('not found', { status: 404 });
    return Response.json({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: jwk.x }] });
  }) as typeof fetch;
}

describe('createAgentVerifier', () => {
  const url = 'https://shop.example/checkout';

  it('verifies a correctly signed request and caches the key directory', async () => {
    const calls: string[] = [];
    const verify = createAgentVerifier({ fetch: directoryFetch(calls), now: () => NOW });
    expect(await verify({ method: 'GET', url, headers: signed(url) })).toEqual({ agent: 'https://chatgpt.com', keyId: keyid, verified: true });
    await verify({ method: 'GET', url, headers: signed(url) });
    expect(calls).toHaveLength(1);
  });

  it('accepts a Headers object', async () => {
    const verify = createAgentVerifier({ fetch: directoryFetch(), now: () => NOW });
    expect((await verify({ method: 'GET', url, headers: new Headers(signed(url)) }))?.verified).toBe(true);
  });

  it('returns null for an unsigned request', async () => {
    const verify = createAgentVerifier({ fetch: directoryFetch(), now: () => NOW });
    expect(await verify({ method: 'GET', url, headers: { 'user-agent': 'ChatGPT-User/1.0' } })).toBeNull();
  });

  it('rejects a signature made for another host (replayed elsewhere)', async () => {
    const verify = createAgentVerifier({ fetch: directoryFetch(), now: () => NOW });
    const r = await verify({ method: 'GET', url: 'https://other.example/checkout', headers: signed(url) });
    expect(r).toMatchObject({ verified: false, reason: 'bad_signature' });
  });

  it('rejects expired signatures and unknown keys', async () => {
    const verify = createAgentVerifier({ fetch: directoryFetch(), now: () => NOW });
    const old = Math.floor(NOW / 1000) - 3600;
    expect(await verify({ method: 'GET', url, headers: signed(url, { created: old, expires: old + 300 }) })).toMatchObject({ reason: 'expired' });
    expect(await verify({ method: 'GET', url, headers: signed(url, { key: 'not-a-known-key' }) })).toMatchObject({ reason: 'unknown_key' });
  });

  it('does not fetch directories it was not told to trust', async () => {
    const calls: string[] = [];
    const verify = createAgentVerifier({ fetch: directoryFetch(calls), now: () => NOW });
    const r = await verify({ method: 'GET', url, headers: signed(url, { agent: 'https://evil.example' }) });
    expect(r).toMatchObject({ verified: false, reason: 'agent_not_allowed', agent: 'https://evil.example' });
    expect(calls).toHaveLength(0);
  });

  it('reports an unreachable directory', async () => {
    const verify = createAgentVerifier({ fetch: (async () => { throw new Error('down'); }) as typeof fetch, now: () => NOW });
    expect(await verify({ method: 'GET', url, headers: signed(url) })).toMatchObject({ verified: false, reason: 'directory_unavailable' });
  });
});
