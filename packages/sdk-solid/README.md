# @trace-id/sdk-solid

SolidJS bindings for Trace.

```tsx
import { IdentifyProvider, createVisitorData } from '@trace-id/sdk-solid';

// once, around the app
<IdentifyProvider apiKey="pk_..." endpoint="https://id.example.com"><App /></IdentifyProvider>

// in a component
const visitor = createVisitorData({ immediate: false });
const result = await visitor.getData({ tags: { action: 'signup' } }); // null if Trace is unavailable
// visitor.data(), visitor.error(), visitor.isLoading() are signals
```

Collection runs in the browser only, never during server rendering. Send `eventId` to your server and verify it with `@trace-id/sdk-node` or another server SDK; never trust the browser result on its own.
