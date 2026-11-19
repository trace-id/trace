# @trace-id/sdk-nuxt

Nuxt 3/4 module for [Trace](../../README.md). It installs the browser client in a client-only plugin and auto-imports `useVisitorData()` and `useIdentifyClient()` from `@trace-id/sdk-vue`. Nothing is collected during server rendering.

```sh
npm install @trace-id/sdk-nuxt @trace-id/sdk-node
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@trace-id/sdk-nuxt'],
  trace: { apiKey: 'pk_...', endpoint: 'https://id.example.com' },
  // or leave these out and set NUXT_PUBLIC_TRACE_KEY / NUXT_PUBLIC_TRACE_ENDPOINT
});
```

```vue
<script setup lang="ts">
const { getData } = useVisitorData({ immediate: false });
</script>
```

Verify the event in a Nitro route with `@trace-id/sdk-node` and your secret key (see the Nuxt quickstart). The key and endpoint are public runtime config; never put a secret key in `trace`.

Tested by building a Nuxt 4 app with the module (the plugin reaches the client bundle, the key reaches runtime config). Nuxt's own engines exclude Node 25, so the monorepo does not install it as a dev dependency.
