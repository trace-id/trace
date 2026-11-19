import { type DeviceResponse, type EventResponse, type VisitorHistoryResponse } from '@trace-id/signals/api';

/** Thin client for the secret-key API the MCP tools use. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiConfig {
  endpoint: string;
  secretKey: string;
  timeoutMs?: number;
}

export class TraceApi {
  private readonly endpoint: string;

  constructor(private readonly config: ApiConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, '');
  }

  private async call<T>(method: 'GET' | 'DELETE', path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.config.secretKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
        redirect: 'error',
      });
    } catch (err) {
      throw new ApiError(0, 'network', `Cannot reach ${this.endpoint}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `HTTP ${res.status}`);
    }
    return json as T;
  }

  event(eventId: string): Promise<EventResponse> {
    return this.call('GET', `/v1/events/${encodeURIComponent(eventId)}`);
  }

  visitor(visitorId: string, limit?: number, cursor?: string): Promise<VisitorHistoryResponse> {
    const q = new URLSearchParams();
    if (limit) q.set('limit', String(limit));
    if (cursor) q.set('cursor', cursor);
    const qs = q.toString();
    return this.call('GET', `/v1/visitors/${encodeURIComponent(visitorId)}${qs ? `?${qs}` : ''}`);
  }

  device(deviceId: string): Promise<DeviceResponse> {
    return this.call('GET', `/v1/devices/${encodeURIComponent(deviceId)}`);
  }

  deleteVisitor(visitorId: string): Promise<void> {
    return this.call('DELETE', `/v1/visitors/${encodeURIComponent(visitorId)}`);
  }
}
