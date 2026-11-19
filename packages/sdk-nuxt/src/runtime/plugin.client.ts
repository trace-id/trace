import { createIdentify } from '@trace-id/sdk-vue';
// @ts-expect-error provided by Nuxt at build time
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';

export default defineNuxtPlugin((nuxtApp: { vueApp: { use: (plugin: unknown) => void } }) => {
  const { traceKey, traceEndpoint } = useRuntimeConfig().public as { traceKey?: string; traceEndpoint?: string };
  if (!traceKey || !traceEndpoint) {
    console.warn('[trace] Set trace.apiKey/endpoint in nuxt.config or NUXT_PUBLIC_TRACE_KEY and NUXT_PUBLIC_TRACE_ENDPOINT.');
    return;
  }
  nuxtApp.vueApp.use(createIdentify({ apiKey: traceKey, endpoint: traceEndpoint }));
});
