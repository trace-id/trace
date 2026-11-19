import { createHash, createPublicKey, verify } from 'node:crypto';
import { type SignedAgent } from '@trace-id/signals/agents';
import {
  checkSignatureTiming,
  jwkThumbprintInput,
  parseSignatureAgent,
  parseWebBotAuth,
  signatureBase,
  type SignedRequest,
} from '@trace-id/signals/web-bot-auth';

export type { SignedAgent } from '@trace-id/signals/agents';

export interface AgentVerifierOptions {
  /**
   * Key-directory origins to trust and fetch from. Requests naming any other Signature-Agent are reported unverified
   * without a network call. Default: ["https://chatgpt.com"]. Use ["*"] to fetch from any https origin.
   */
  allowedAgents?: string[];
  /** How long a fetched key directory is reused. Default 1 hour. */
  cacheMs?: number;
  /** Directory fetch timeout. Default 1500 ms. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface AgentRequest {
  method: string;
  /** Absolute URL, e.g. https://shop.example/checkout */
  url: string;
  headers: Headers | Record<string, string | string[] | undefined>;
}

type Jwk = { kty?: unknown; crv?: unknown; x?: unknown };

const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';

function headerGetter(headers: AgentRequest['headers']): (name: string) => string | null {
  if (typeof (headers as Headers).get === 'function') return (n) => (headers as Headers).get(n);
  const lower = new Map(Object.entries(headers as Record<string, string | string[] | undefined>).map(([k, v]) => [k.toLowerCase(), v]));
  return (n) => {
    const v = lower.get(n.toLowerCase());
    return v === undefined ? null : Array.isArray(v) ? v.join(', ') : v;
  };
}

/**
 * Verifies Web Bot Auth signatures (RFC 9421 HTTP Message Signatures, Ed25519) on incoming requests, so you can tell a
 * signed AI agent such as ChatGPT agent from anything that only claims to be one. Use it on any route: checkout, login,
 * an API or an MCP server.
 *
 *   const verifyAgent = createAgentVerifier();
 *   const agent = await verifyAgent({ method: req.method, url: fullUrl, headers: req.headers });
 *   if (agent?.verified) tagOrder({ agent: agent.agent });
 *
 * Returns null when the request carries no Web Bot Auth signature.
 */
export function createAgentVerifier(options: AgentVerifierOptions = {}): (req: AgentRequest) => Promise<SignedAgent | null> {
  const allowed = options.allowedAgents ?? ['https://chatgpt.com'];
  const anyAgent = allowed.includes('*');
  const cacheMs = options.cacheMs ?? 3_600_000;
  const timeoutMs = options.timeoutMs ?? 1500;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; keys: Map<string, Jwk> }>();

  async function directory(origin: string): Promise<Map<string, Jwk> | null> {
    const hit = cache.get(origin);
    if (hit && now() - hit.at < cacheMs) return hit.keys;
    try {
      const res = await doFetch(`${origin}${DIRECTORY_PATH}`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { accept: 'application/http-message-signatures-directory+json, application/json' } });
      if (!res.ok) return null;
      const body = (await res.json()) as { keys?: Jwk[] };
      const keys = new Map<string, Jwk>();
      for (const jwk of Array.isArray(body.keys) ? body.keys : []) {
        const input = jwkThumbprintInput(jwk);
        if (input) keys.set(createHash('sha256').update(input).digest('base64url'), jwk);
      }
      cache.set(origin, { at: now(), keys });
      return keys;
    } catch {
      return null;
    }
  }

  return async (req) => {
    const header = headerGetter(req.headers);
    const parsed = parseWebBotAuth(header('signature-input'), header('signature'));
    if (!parsed) return null;
    const agent = parseSignatureAgent(header('signature-agent'));
    const keyId = parsed.params.keyid ?? '';
    const fail = (reason: string): SignedAgent => ({ agent: agent ?? '', keyId, verified: false, reason });
    if (!agent) return fail('missing_signature_agent');
    const timing = checkSignatureTiming(parsed.params, Math.floor(now() / 1000));
    if (timing) return fail(timing);
    if (!anyAgent && !allowed.includes(agent)) return fail('agent_not_allowed');
    const signed: SignedRequest = { method: req.method, url: req.url, header };
    const base = signatureBase(parsed, signed);
    if (base === null) return fail('unsupported_components');
    const keys = await directory(agent);
    if (!keys) return fail('directory_unavailable');
    const jwk = keys.get(keyId);
    if (!jwk) return fail('unknown_key');
    try {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x as string }, format: 'jwk' });
      const ok = verify(null, Buffer.from(base), key, Buffer.from(parsed.signature, 'base64'));
      return ok ? { agent, keyId, verified: true } : fail('bad_signature');
    } catch {
      return fail('bad_signature');
    }
  };
}
