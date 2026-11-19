# @trace-id/sdk-next

Next.js (App Router) integration for Trace.

```tsx
// app/trace-provider.tsx
'use client';
export { IdentifyProvider as TraceProvider } from '@trace-id/sdk-next/client';
```

```tsx
// app/layout.tsx
<TraceProvider apiKey={process.env.NEXT_PUBLIC_TRACE_KEY!} endpoint={process.env.NEXT_PUBLIC_TRACE_URL!}>{children}</TraceProvider>
```

```ts
// app/api/signup/route.ts  (server: TRACE_SECRET_KEY, TRACE_ENDPOINT)
import { withTrace } from '@trace-id/sdk-next/server';

export const POST = withTrace(
  async (request, { event }) => Response.json({ ok: true, visitor: event?.visitorId }),
  { reject: (e) => e.suspectScore >= 80 },
);
```

In the browser, call `useVisitorData({ immediate: false })` and send `data.eventId` with the request, in the `x-trace-event-id` header or the JSON body. Never decide from a `visitorId` or score sent by the browser; `withTrace` verifies the event with your secret key. See [docs/integration.md](../../docs/integration.md).
