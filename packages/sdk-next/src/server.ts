import { type EventResponse } from '@trace-id/signals/api';
import { guardRequest, type GuardOptions } from '@trace-id/sdk-node/web';

export { verifyEvent, labelEvent, unlabelEvent, type VerifyOptions } from '@trace-id/sdk-node';
export { VerifyError } from '@trace-id/sdk-node/errors';
export { guardRequest, type GuardOptions } from '@trace-id/sdk-node/web';

/** What a guarded route handler receives next to the request. */
export interface TraceContext {
  /** The server-verified event. Null only when `failOpen` let the request through or `required: false`. */
  event: EventResponse | null;
}

/**
 * Wraps an App Router route handler. The event id comes from the `x-trace-event-id` header or the JSON body, is
 * verified with `TRACE_SECRET_KEY` and `TRACE_ENDPOINT`, and your handler runs only if it passes.
 *
 *     export const POST = withTrace(async (request, { event }) => {
 *       return Response.json({ ok: true, visitor: event?.visitorId });
 *     }, { reject: (e) => e.suspectScore >= 80 });
 *
 * Next.js passes a second `{ params }` argument; it is forwarded as the third argument here.
 */
export function withTrace<Args extends unknown[]>(
  handler: (request: Request, trace: TraceContext, ...rest: Args) => Response | Promise<Response>,
  options: GuardOptions = {},
): (request: Request, ...rest: Args) => Promise<Response> {
  return async (request, ...rest) => {
    const guard = await guardRequest(request, options);
    if (guard.response) return guard.response;
    return handler(request, { event: guard.event }, ...rest);
  };
}
