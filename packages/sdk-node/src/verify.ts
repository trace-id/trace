import { type EventResponse } from '@tbdname/signals/api';
import { VerifyError, type VerifyErrorCode } from './errors.js';

export interface VerifyOptions {
  /** Secret key (`sk_...`). Keep it on your server. */
  secretKey: string;
  /** Base URL of the server, e.g. `https://id.example.com`. */
  endpoint: string;
  /** Default 2000 ms. Decide yourself whether a timeout fails open or closed. */
  timeoutMs?: number;
}

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function codeFor(status: number, serverCode: string | null): VerifyErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 410 || serverCode === 'event_expired') return 'expired';
  if (status === 429) return 'rate_limited';
  if (status === 400) return 'invalid_event_id';
  return 'server_error';
}

function isEventResponse(value: unknown): value is EventResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.eventId === 'string' &&
    typeof v.visitorId === 'string' &&
    typeof v.confidence === 'number' &&
    typeof v.suspectScore === 'number' &&
    Array.isArray(v.reasons) &&
    typeof v.signals === 'object' &&
    v.signals !== null
  );
}

/**
 * Fetches the full, server-recorded event. This is the only result you should trust:
 * whatever the browser sends you (visitorId, score) can be forged.
 */
export async function verifyEvent(eventId: string, options: VerifyOptions): Promise<EventResponse> {
  if (!EVENT_ID.test(eventId)) {
    throw new VerifyError('invalid_event_id', 'eventId is not a valid event id');
  }
  if (!options.secretKey.startsWith('sk_')) {
    throw new VerifyError('unauthorized', 'secretKey must be a secret key (sk_...)');
  }
  const url = `${options.endpoint.replace(/\/+$/, '')}/v1/events/${eventId}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${options.secretKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 2000),
      redirect: 'error',
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new VerifyError('timeout', 'Verification timed out');
    }
    throw new VerifyError('network', err instanceof Error ? err.message : 'Network error');
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const serverError = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const serverCode = typeof serverError?.code === 'string' ? serverError.code : null;
    const retryAfter = Number(res.headers.get('Retry-After'));
    throw new VerifyError(
      codeFor(res.status, serverCode),
      typeof serverError?.message === 'string' ? serverError.message : `HTTP ${res.status}`,
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  if (!isEventResponse(json)) {
    throw new VerifyError('invalid_response', 'Unexpected response shape', res.status);
  }
  return json;
}
