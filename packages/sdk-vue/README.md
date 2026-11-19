# @trace-id/sdk-vue

Vue 3 plugin and composable for Trace.

```ts
// main.ts
import { createIdentify } from '@trace-id/sdk-vue';
app.use(createIdentify({ apiKey: 'pk_...', endpoint: 'https://id.example.com' }));
```

```vue
<script setup lang="ts">
import { useVisitorData } from '@trace-id/sdk-vue';
const { data, error, isLoading, getData } = useVisitorData({ immediate: false });
async function onSubmit() {
  const result = await getData({ linkedId: user.id });
  await api.post('/signup', { ...form, eventId: result?.eventId });
}
</script>
```

Verify `eventId` on your server with a server SDK. Collection never runs during server-side rendering (Nuxt).
