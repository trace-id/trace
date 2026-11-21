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
import { IdentifyProvider as ReactIdentifyProvider, type IdentifyProviderProps } from '@trace-id/sdk-react';
import { createElement } from 'react';
import { VIA } from './via.js';

export {
  useIdentifyClient,
  useVisitorData,
  type IdentifyProviderProps,
  type UseVisitorDataOptions,
  type VisitorDataState,
} from '@trace-id/sdk-react';

/** The React provider, reporting events as coming from @trace-id/sdk-next. */
export function IdentifyProvider(props: IdentifyProviderProps) {
  return createElement(ReactIdentifyProvider, { ...props, via: props.via ?? VIA });
}
