import { IdentifyError, type IdentifyErrorCode } from '@trace-id/sdk-js/errors';
import { type IdentifyRequest, type IdentifyResponse, type TagValue } from '@trace-id/signals/api';
import { buildPayload, type NativeReadings, toHex } from './core.js';

export type IdentifyResult = Omit<IdentifyResponse, 'token'>;

export interface GetOptions {
  /** Your user or account id, if known. Never an email or name. */
  linkedId?: string;
  /** Up to 10 short tags returned with the event (e.g. { screen: 'checkout' }). */
  tags?: Record<string, TagValue>;
}

/** Where the SDK keeps the visitor token: Keychain / Keystore via expo-secure-store in an app. */
export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ClientDeps {
  readings: () => Promise<NativeReadings>;
  store: TokenStore | null;
  randomBytes: (n: number) => Uint8Array;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface ClientOptions {
  /** Public key (pk_...). Add `app:<your bundle or application id>` to its allowed origins. */
  apiKey: string;
  /** Your Trace server, e.g. https://id.example.com. */
  endpoint: string;
  /** Keep the visitor token in secure storage so the visitor is recognised across launches. Default true. */
  persistToken?: boolean;
  /** Request timeout. Default 10 s (mobile networks are slower than the browser default). */
  timeoutMs?: number;
}

function errorCodeFor(status: number, serverCode: string | null): IdentifyErrorCode {
  if (status === 401) return 'invalid_api_key';
  if (status === 403) return serverCode === 'origin_not_allowed' ? 'origin_not_allowed' : 'invalid_api_key';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'server_error';
}

function isIdentifyResponse(v: unknown): v is IdentifyResponse {
  const r = v as Partial<IdentifyResponse> | null;
  return !!r && typeof r.eventId === 'string' && typeof r.visitorId === 'string' && typeof r.token === 'string' && typeof r.confidence === 'number';
}

/**
 * Collects device readings and identifies the device with your Trace server. Send `eventId` to your backend and verify
 * it there with the secret key: anything an app reports can be forged on a rooted device.
 */
export class Client {
  private enabled = true;

  constructor(
    private readonly options: ClientOptions,
    private readonly deps: ClientDeps,
  ) {
    if (options.apiKey.startsWith('sk_')) throw new Error('Use a public key (pk_...) in the app; secret keys belong on your server');
  }

  /** Consent: stop collecting until enable(); with forget, also delete the stored token. */
  async disable(forget = false): Promise<void> {
    this.enabled = false;
    if (forget) await this.deps.store?.clear();
  }

  enable(): void {
    this.enabled = true;
  }

  async get(opts: GetOptions = {}): Promise<IdentifyResult> {
    if (!this.enabled) throw new IdentifyError('collection_disabled', 'Collection is disabled');
    const now = this.deps.now ?? Date.now;
    const started = now();
    const persist = this.options.persistToken !== false;
    const [readings, token] = await Promise.all([this.deps.readings(), persist && this.deps.store ? this.deps.store.get().catch(() => null) : null]);
    const body: IdentifyRequest = { signals: buildPayload(readings, now() - started), sdk: { name: '@trace-id/sdk-react-native', version: '0.1.0' } };
    if (token) body.token = token;
    if (opts.linkedId !== undefined) body.linkedId = opts.linkedId;
    if (opts.tags !== undefined) body.tags = opts.tags;
    body.sentAt = now();
    body.nonce = toHex(this.deps.randomBytes(16));

    const doFetch = this.deps.fetch ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await doFetch(`${this.options.endpoint.replace(/\/+$/, '')}/v1/identify?apiKey=${encodeURIComponent(this.options.apiKey)}`, {
        method: 'POST',
        // No Origin from a native app: the server checks this id against the key's app:<id> entries.
        headers: { 'Content-Type': 'text/plain', ...(readings.appId ? { 'X-Trace-App': readings.appId } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new IdentifyError('timeout', 'Request timed out');
      throw new IdentifyError('network', err instanceof Error ? err.message : 'Network error');
    } finally {
      clearTimeout(timer);
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const serverError = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      const serverCode = typeof serverError?.code === 'string' ? serverError.code : null;
      const retryAfter = Number(res.headers.get('Retry-After'));
      throw new IdentifyError(
        errorCodeFor(res.status, serverCode),
        typeof serverError?.message === 'string' ? serverError.message : `HTTP ${res.status}`,
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      );
    }
    if (!isIdentifyResponse(json)) throw new IdentifyError('invalid_response', 'Unexpected response shape', res.status);
    if (persist && this.deps.store) await this.deps.store.set(json.token).catch(() => undefined);
    const { token: _token, ...result } = json;
    return result;
  }
}
