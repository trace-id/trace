import { type IdentifyRequest, type IdentifyResponse, type TagValue } from '@trace-id/signals/api';
import { type SignalPayload } from '@trace-id/signals/types';
import { collectSignals } from './collect.js';
import { BehaviorRecorder } from './collectors/behavior.js';
import { clearToken, loadToken, saveToken } from './collectors/storage.js';
import { IdentifyError, type IdentifyErrorCode } from './errors.js';
import { SDK_NAME, SDK_VERSION } from './version.js';

export interface ClientOptions {
  /** Public key (`pk_...`). Never put a secret key in the browser. */
  apiKey: string;
  /** Base URL of the server, e.g. `https://id.example.com`. */
  endpoint: string;
  /** Total budget for collect + request. Default 5000 ms. */
  timeoutMs?: number;
  /** Persist the visitor token in cookie, localStorage and IndexedDB. Default true. */
  persistToken?: boolean;
  /**
   * Also keep the visitor token in an HttpOnly cookie set by the server. Only works when the server is same-site with
   * the page: served from a path or subdomain of your own site through a proxy (see the integration guide). Survives
   * the 7-day cap Safari puts on storage that scripts write. Default false.
   */
  firstPartyCookie?: boolean;
  /** Start disabled until a consent manager calls `enable()`. Default true. */
  enabled?: boolean;
  /** Replaces signal collection; for tests. */
  collector?: () => Promise<SignalPayload>;
  /**
   * Set by the framework packages (@trace-id/sdk-react, sdk-vue and so on) so the dashboard can show which package an
   * event came from. Leave it unset when you use this package directly.
   */
  via?: { name: string; version: string };
}

export interface GetOptions {
  /** Your own account/user id, used for per-account velocity. */
  linkedId?: string;
  tags?: Record<string, TagValue>;
}

export type IdentifyResult = Omit<IdentifyResponse, 'token'>;

const STORAGE_TIMEOUT_MS = 300;

function errorCodeFor(status: number, serverCode: string | null): IdentifyErrorCode {
  if (status === 401) return 'invalid_api_key';
  if (status === 403) return serverCode === 'origin_not_allowed' ? 'origin_not_allowed' : 'invalid_api_key';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'server_error';
}

function isIdentifyResponse(value: unknown): value is IdentifyResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.eventId === 'string' &&
    typeof v.visitorId === 'string' &&
    typeof v.confidence === 'number' &&
    typeof v.suspectScore === 'number' &&
    typeof v.token === 'string'
  );
}

export class Client {
  private readonly options: Required<Omit<ClientOptions, 'collector' | 'via'>> & Pick<ClientOptions, 'collector' | 'via'>;
  private enabled: boolean;
  private behavior: BehaviorRecorder | null = null;

  constructor(options: ClientOptions) {
    if (!options.apiKey.startsWith('pk_')) {
      throw new IdentifyError('invalid_api_key', 'apiKey must be a public key (pk_...)');
    }
    this.options = {
      timeoutMs: 5000,
      persistToken: true,
      firstPartyCookie: false,
      enabled: true,
      ...options,
      endpoint: options.endpoint.replace(/\/+$/, ''),
    };
    this.enabled = this.options.enabled;
    if (this.enabled) this.behavior = new BehaviorRecorder();
  }

  enable(): void {
    this.enabled = true;
    this.behavior ??= new BehaviorRecorder();
  }

  /** Stops collection. Pass `clearStoredData` to also delete the persisted visitor token (and the server cookie). */
  async disable(clearStoredData = false): Promise<void> {
    this.enabled = false;
    this.behavior?.stop();
    this.behavior = null;
    if (!clearStoredData) return;
    await clearToken(STORAGE_TIMEOUT_MS);
    if (this.options.firstPartyCookie) {
      await fetch(`${this.options.endpoint}/v1/identify/forget?apiKey=${encodeURIComponent(this.options.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
        credentials: 'include',
      }).catch(() => undefined);
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async get(opts: GetOptions = {}): Promise<IdentifyResult> {
    if (!this.enabled) {
      throw new IdentifyError('collection_disabled', 'Collection is disabled');
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new IdentifyError('timeout', `Timed out after ${this.options.timeoutMs} ms`));
      }, this.options.timeoutMs);
    });
    try {
      return await Promise.race([this.run(opts, controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async run(opts: GetOptions, signal: AbortSignal): Promise<IdentifyResult> {
    const behavior = this.behavior?.snapshot();
    const collect = this.options.collector ?? (() => collectSignals(behavior ? { behavior } : {}));
    const [signals, token] = await Promise.all([
      collect(),
      this.options.persistToken ? loadToken(STORAGE_TIMEOUT_MS) : Promise.resolve(null),
    ]);
    const body: IdentifyRequest = { signals, sdk: { name: SDK_NAME, version: SDK_VERSION } };
    if (this.options.via) body.via = this.options.via;
    if (token) body.token = token;
    if (opts.linkedId !== undefined) body.linkedId = opts.linkedId;
    if (opts.tags !== undefined) body.tags = opts.tags;
    body.sentAt = Date.now();
    const nonce = randomNonce();
    if (nonce) body.nonce = nonce;

    let res: Response;
    try {
      // text/plain keeps this a CORS "simple request": no preflight round trip.
      res = await fetch(`${this.options.endpoint}/v1/identify?apiKey=${encodeURIComponent(this.options.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(body),
        credentials: this.options.firstPartyCookie ? 'include' : 'omit',
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw new IdentifyError('timeout', 'Request aborted');
      throw new IdentifyError('network', err instanceof Error ? err.message : 'Network error');
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
    if (!isIdentifyResponse(json)) {
      throw new IdentifyError('invalid_response', 'Unexpected response shape', res.status);
    }
    if (this.options.persistToken) await saveToken(json.token, STORAGE_TIMEOUT_MS);
    const { token: _token, ...result } = json;
    return result;
  }
}

export function createClient(options: ClientOptions): Client {
  return new Client(options);
}

/** 16 random bytes as hex, new for every identify call; null where Web Crypto is missing. */
function randomNonce(): string | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) return null;
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}
