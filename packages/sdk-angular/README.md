# @trace-id/sdk-angular

Angular 17+ bindings for Trace, built on signals. No zone.js or decorators needed.

```ts
// app.config.ts
import { provideTrace } from '@trace-id/sdk-angular';
export const appConfig = { providers: [provideTrace({ apiKey: 'pk_...', endpoint: 'https://id.example.com' })] };
```

```ts
// signup.component.ts
import { injectVisitorData } from '@trace-id/sdk-angular';

export class SignupComponent {
  readonly visitor = injectVisitorData({ immediate: false });

  async submit() {
    const result = await this.visitor.getData({ tags: { action: 'signup' } });
    // send result?.eventId to your backend and verify it there
  }
}
```

Collection runs in the browser only (after the first render), never during server-side rendering. Send `eventId` to your server and verify it with `@trace-id/sdk-node` or another server SDK; never trust the browser result on its own.
