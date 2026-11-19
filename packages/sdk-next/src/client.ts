'use client';

/**
 * Client entry for the App Router. Import from here in client components, or mount the provider once in a small
 * `'use client'` file and render it from `app/layout.tsx`:
 *
 *     'use client';
 *     export { IdentifyProvider as TraceProvider } from '@trace-id/sdk-next/client';
 *
 * Collection runs in the browser only; nothing runs during server rendering.
 */
export {
  IdentifyProvider,
  useIdentifyClient,
  useVisitorData,
  type IdentifyProviderProps,
  type UseVisitorDataOptions,
  type VisitorDataState,
} from '@trace-id/sdk-react';
