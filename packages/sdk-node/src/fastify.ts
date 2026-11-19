import { type EventResponse } from '@trace-id/signals/api';
import { errorBody, eventIdFrom, runGuard, type GuardOptions } from './guard.js';

export type { GuardOptions } from './guard.js';

export interface TraceFastifyRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  /** The verified event, set when the guard passes. */
  trace?: EventResponse | null;
}
interface TraceFastifyReply {
  code(status: number): { send(body: unknown): unknown };
}

/**
 * Fastify `preHandler` hook. Reads the event id from `x-trace-event-id` or the parsed body, verifies it and sets
 * `request.trace`.
 *
 *     app.post('/signup', { preHandler: traceHook({ reject: (e) => e.suspectScore >= 80 }) }, handler);
 */
export function traceHook(options: GuardOptions = {}) {
  return async (request: TraceFastifyRequest, reply: TraceFastifyReply): Promise<unknown> => {
    const outcome = await runGuard(eventIdFrom(request.headers, request.body, options), options);
    if (!outcome.ok) return reply.code(outcome.status).send(errorBody(outcome));
    request.trace = outcome.event;
    return undefined;
  };
}
