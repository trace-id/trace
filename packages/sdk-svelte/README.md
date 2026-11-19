# @trace-id/sdk-svelte

A Svelte store for Trace. It has no Svelte import, so the same store works with Angular's `async` pipe, Solid or plain
callbacks.

```svelte
<script>
  import { createVisitorData } from '@trace-id/sdk-svelte';
  const visitor = createVisitorData({ apiKey: 'pk_...', endpoint: 'https://id.example.com' }, { immediate: false });
  async function submit() {
    const result = await visitor.getData({ linkedId: user.id });
    await fetch('/signup', { method: 'POST', body: JSON.stringify({ eventId: result?.eventId }) });
  }
</script>

{#if $visitor.isLoading}Checking...{/if}
```

Angular: `visitor$ = createVisitorData(options)`; in a template, `(visitor$ | async)?.data?.visitorId`.
