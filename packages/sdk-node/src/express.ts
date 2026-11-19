import { type EventResponse } from '@trace-id/signals/api';
import { errorBody, eventIdFrom, runGuard, type GuardOptions } from './guard.js';

export type { GuardOptions } from './guard.js';

/** The parts of an Express (or Connect, Nest on Express) request this adapter uses. */
export interface TraceRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  /** The verified event, set when the guard passes. Null when `failOpen` let the request through or no id was required. */
  trace?: EventResponse | null;
}
interface TraceResponse {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Express and Nest (Express platform) middleware. Reads the event id from `x-trace-event-id` or the JSON body, verifies
 * it with your secret key and sets `req.trace`. Mount it after `express.json()`.
 *
 *     app.post('/signup', traceGuard({ reject: (e) => e.suspectScore >= 80 }), handler);
 */
export function traceGuard(options: GuardOptions = {}) {
  return async (req: TraceRequest, res: TraceResponse, next: (err?: unknown) => void): Promise<void> => {
    try {
      const outcome = await runGuard(eventIdFrom(req.headers, req.body, options), options);
      if (!outcome.ok) {
        res.status(outcome.status).json(errorBody(outcome));
        return;
      }
      req.trace = outcome.event;
      next();
    } catch (err) {
      next(err);
    }
  };
}
