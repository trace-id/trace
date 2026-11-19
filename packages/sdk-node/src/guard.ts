import { type EventResponse } from '@trace-id/signals/api';
import { VerifyError } from './errors.js';
import { verifyEvent, type VerifyOptions } from './verify.js';

/** Shared by the Express, Fastify and fetch (Next, Hono, Workers) adapters. */
export interface GuardOptions extends Partial<VerifyOptions> {
  /** Header that carries the event id. Default `x-trace-event-id`. */
  header?: string;
  /** JSON body field that carries the event id. Default `eventId`. */
  bodyField?: string;
  /** Reject requests with no event id. Default true. */
  required?: boolean;
  /**
   * When Trace is unreachable (timeout, network, 5xx, rate limit), let the request through with `event` set to null
   * instead of answering 503. Default false (fail closed). Misconfiguration (bad key) never fails open.
   */
  failOpen?: boolean;
  /** Return true to answer 403. Runs only on a verified event; the decision stays on your server. */
  reject?: (event: EventResponse) => boolean | Promise<boolean>;
}

export type GuardOutcome =
  | { ok: true; event: EventResponse | null }
  | { ok: false; status: number; code: string; message: string };

const TRANSIENT = new Set(['timeout', 'network', 'server_error', 'rate_limited', 'limit_reached', 'invalid_response']);

/** Reads `TRACE_SECRET_KEY` and `TRACE_ENDPOINT` when the options do not give them. */
export function resolveVerifyOptions(options: GuardOptions): VerifyOptions | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const secretKey = options.secretKey ?? env.TRACE_SECRET_KEY;
  const endpoint = options.endpoint ?? env.TRACE_ENDPOINT;
  if (!secretKey || !endpoint) return null;
  return { secretKey, endpoint, ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) };
}

/** Verifies one event id on the server and applies the guard rules. Never throws for expected failures. */
export async function runGuard(eventId: string | undefined, options: GuardOptions): Promise<GuardOutcome> {
  if (!eventId) {
    if (options.required === false) return { ok: true, event: null };
    return { ok: false, status: 400, code: 'event_required', message: 'Missing Trace event id' };
  }
  const verify = resolveVerifyOptions(options);
  if (!verify) {
    return { ok: false, status: 500, code: 'trace_misconfigured', message: 'Set secretKey and endpoint (or TRACE_SECRET_KEY and TRACE_ENDPOINT)' };
  }
  let event: EventResponse;
  try {
    event = await verifyEvent(eventId, verify);
  } catch (err) {
    if (!(err instanceof VerifyError)) throw err;
    if (TRANSIENT.has(err.code)) {
      if (options.failOpen) return { ok: true, event: null };
      return { ok: false, status: 503, code: 'trace_unavailable', message: 'Trace could not verify the event' };
    }
    if (err.code === 'unauthorized') {
      return { ok: false, status: 500, code: 'trace_misconfigured', message: 'Trace rejected the secret key' };
    }
    return { ok: false, status: 400, code: 'event_invalid', message: 'The Trace event id is invalid or expired' };
  }
  if (options.reject && (await options.reject(event))) {
    return { ok: false, status: 403, code: 'trace_rejected', message: 'Request rejected' };
  }
  return { ok: true, event };
}

/** First string value of a header bag (Node style: values may be arrays). */
export function headerValue(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const v = headers?.[name.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

/** Event id from the header, else from a parsed JSON body. */
export function eventIdFrom(
  headers: Record<string, string | string[] | undefined> | undefined,
  body: unknown,
  options: GuardOptions,
): string | undefined {
  const fromHeader = headerValue(headers, options.header ?? 'x-trace-event-id');
  if (fromHeader) return fromHeader;
  if (typeof body === 'object' && body !== null) {
    const v = (body as Record<string, unknown>)[options.bodyField ?? 'eventId'];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

export function errorBody(outcome: Extract<GuardOutcome, { ok: false }>): { error: { code: string; message: string } } {
  return { error: { code: outcome.code, message: outcome.message } };
}
