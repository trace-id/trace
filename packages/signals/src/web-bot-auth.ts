/**
 * Web Bot Auth: agents that sign their HTTP requests with HTTP Message Signatures (RFC 9421), publishing their Ed25519
 * keys at <agent>/.well-known/http-message-signatures-directory. This module is the pure part: header parsing, timing
 * checks and the signature base. Fetching keys and checking the signature live in @trace-id/sdk-node (agents.ts).
 *
 * Supported: Ed25519, tag "web-bot-auth", plain component identifiers (derived components and header names, without
 * parameters). Anything else is reported as unsupported rather than guessed.
 */

export interface SignatureParams {
  created?: number;
  expires?: number;
  keyid?: string;
  alg?: string;
  tag?: string;
  nonce?: string;
}

export interface ParsedWebBotAuth {
  label: string;
  components: string[];
  params: SignatureParams;
  /** The inner list with its parameters exactly as sent: the value of "@signature-params". */
  paramsRaw: string;
  /** Base64 signature bytes from the Signature header. */
  signature: string;
}

export interface SignedRequest {
  method: string;
  /** Absolute URL of the request, e.g. https://shop.example/checkout?x=1 */
  url: string;
  /** Header lookup, case-insensitive. */
  header(name: string): string | null | undefined;
}

/** Splits a structured-field dictionary into top-level members, ignoring commas inside quotes, parens or byte sequences. */
function members(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let bytes = false;
  let cur = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (quote) {
      cur += c;
      if (c === '\\') cur += value[++i] ?? '';
      else if (c === '"') quote = false;
      continue;
    }
    if (c === '"') quote = true;
    else if (c === ':') bytes = !bytes;
    else if (c === '(' && !bytes) depth++;
    else if (c === ')' && !bytes) depth--;
    else if (c === ',' && depth === 0 && !bytes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function splitMember(m: string): [string, string] | null {
  const eq = m.indexOf('=');
  if (eq <= 0) return null;
  return [m.slice(0, eq).trim(), m.slice(eq + 1).trim()];
}

function unquote(v: string): string | null {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(v.trim());
  return m ? m[1]!.replace(/\\(.)/g, '$1') : null;
}

/** Parses one Signature-Input member value: ("a" "b");created=1;keyid="x" */
function parseInput(value: string): { components: string[]; params: SignatureParams } | null {
  const m = /^\(([^)]*)\)(.*)$/.exec(value);
  if (!m) return null;
  const components: string[] = [];
  for (const item of m[1]!.trim().split(/\s+/).filter(Boolean)) {
    // Component parameters (;key=, ;sf, ;bs, ;req) change the value; not supported.
    if (item.includes(';')) return null;
    const name = unquote(item);
    if (name === null) return null;
    components.push(name.toLowerCase());
  }
  const params: SignatureParams = {};
  for (const p of m[2]!.split(';').map((x) => x.trim()).filter(Boolean)) {
    const kv = splitMember(p);
    if (!kv) continue;
    const [k, v] = kv;
    if (k === 'created' || k === 'expires') {
      const n = Number(v);
      if (Number.isInteger(n)) params[k] = n;
    } else if (k === 'keyid' || k === 'alg' || k === 'tag' || k === 'nonce') {
      const s = unquote(v);
      if (s !== null) params[k] = s;
    }
  }
  return { components, params };
}

/** Finds the Web Bot Auth signature on a request (tag "web-bot-auth"). Null when the request is not signed that way. */
export function parseWebBotAuth(signatureInput: string | null | undefined, signature: string | null | undefined): ParsedWebBotAuth | null {
  if (!signatureInput || !signature) return null;
  const sigs = new Map<string, string>();
  for (const m of members(signature)) {
    const kv = splitMember(m);
    const bytes = kv && /^:([A-Za-z0-9+/=]+):$/.exec(kv[1]);
    if (kv && bytes) sigs.set(kv[0], bytes[1]!);
  }
  for (const m of members(signatureInput)) {
    const kv = splitMember(m);
    if (!kv) continue;
    const parsed = parseInput(kv[1]);
    const sig = sigs.get(kv[0]);
    if (!parsed || !sig || parsed.params.tag !== 'web-bot-auth') continue;
    return { label: kv[0], components: parsed.components, params: parsed.params, paramsRaw: kv[1], signature: sig };
  }
  return null;
}

/** The agent's key directory origin from Signature-Agent: a quoted https URL (or the first dictionary member). */
export function parseSignatureAgent(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = members(value)[0] ?? '';
  const kv = /^[a-z][a-z0-9_.*-]*=/.test(first) ? splitMember(first) : null;
  const raw = unquote(kv ? kv[1] : first) ?? first.trim();
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Null when the timing is acceptable, otherwise the reason. Signatures must say when they were made and expire within a day. */
export function checkSignatureTiming(params: SignatureParams, nowSec: number, skewSec = 60): string | null {
  if (params.alg !== undefined && params.alg !== 'ed25519') return 'unsupported_alg';
  if (params.keyid === undefined) return 'missing_keyid';
  if (params.created === undefined || params.expires === undefined) return 'missing_timestamps';
  if (params.created > nowSec + skewSec) return 'created_in_future';
  if (params.expires <= nowSec - skewSec) return 'expired';
  if (params.expires - params.created > 86_400) return 'validity_too_long';
  return null;
}

function componentValue(name: string, req: SignedRequest, url: URL): string | null {
  switch (name) {
    case '@method':
      return req.method.toUpperCase();
    case '@authority':
      return url.host.toLowerCase();
    case '@scheme':
      return url.protocol.replace(':', '').toLowerCase();
    case '@target-uri':
      return url.href;
    case '@path':
      return url.pathname || '/';
    case '@query':
      return url.search || '?';
    case '@request-target':
      return `${url.pathname || '/'}${url.search}`;
    default: {
      if (name.startsWith('@')) return null;
      const v = req.header(name);
      return v === null || v === undefined ? null : v.trim().replace(/\s*\n\s*/g, ' ');
    }
  }
}

/**
 * The RFC 9421 signature base for a parsed signature, or null when a covered component is missing or unsupported.
 * Web Bot Auth requires "@authority"; when a Signature-Agent header is sent it must be covered too.
 */
export function signatureBase(parsed: ParsedWebBotAuth, req: SignedRequest): string | null {
  if (!parsed.components.includes('@authority')) return null;
  if (req.header('signature-agent') && !parsed.components.includes('signature-agent')) return null;
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  const lines: string[] = [];
  for (const c of parsed.components) {
    const v = componentValue(c, req, url);
    if (v === null) return null;
    lines.push(`"${c}": ${v}`);
  }
  lines.push(`"@signature-params": ${parsed.paramsRaw}`);
  return lines.join('\n');
}

/** RFC 7638 thumbprint input for an Ed25519 JWK (hash it with SHA-256 and base64url-encode to get the keyid). */
export function jwkThumbprintInput(jwk: { kty?: unknown; crv?: unknown; x?: unknown }): string | null {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') return null;
  return `{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`;
}
