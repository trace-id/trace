import { type EventResponse } from '@trace-id/signals/api';
import { errorBody, eventIdFrom, runGuard, type GuardOptions } from './guard.js';

export type { GuardOptions } from './guard.js';

export type RequestGuardResult = { event: EventResponse | null; response?: undefined } | { response: Response; event?: undefined };

/**
 * For fetch-style frameworks: Next.js route handlers, Hono, Remix, SvelteKit, Astro, Cloudflare Workers. The event id is read
 * from the header, a JSON body or a form body (urlencoded or multipart); the request body stays readable afterwards.
 * Returns `{ event }` when the request may continue, or `{ response }` to send back at once.
 *
 *     const guard = await guardRequest(request);
 *     if (guard.response) return guard.response;
 *     // guard.event is the verified event (null only with failOpen or required: false)
 */
export async function guardRequest(request: Request, options: GuardOptions = {}): Promise<RequestGuardResult> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  let body: unknown;
  const type = request.headers.get('content-type') ?? '';
  if (!headers[(options.header ?? 'x-trace-event-id').toLowerCase()]) {
    if (type.includes('json')) {
      body = await request.clone().json().catch(() => undefined);
    } else if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      // Plain HTML forms (Remix, SvelteKit actions, WordPress-style posts). The clone leaves the body readable for you.
      const form = await request.clone().formData().catch(() => undefined);
      const value = form?.get(options.bodyField ?? 'eventId');
      if (typeof value === 'string') body = { [options.bodyField ?? 'eventId']: value };
    }
  }
  const outcome = await runGuard(eventIdFrom(headers, body, options), options);
  if (!outcome.ok) {
    return {
      response: new Response(JSON.stringify(errorBody(outcome)), {
        status: outcome.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  return { event: outcome.event };
}
