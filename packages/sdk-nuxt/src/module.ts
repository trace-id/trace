import { addImports, addPlugin, createResolver, defineNuxtModule } from '@nuxt/kit';

export interface ModuleOptions {
  /** Public key (pk_...). Falls back to NUXT_PUBLIC_TRACE_KEY at runtime. */
  apiKey?: string;
  /** Your Trace server. Falls back to NUXT_PUBLIC_TRACE_ENDPOINT at runtime. */
  endpoint?: string;
}

/**
 * Registers a client-only plugin that installs the Trace client, and auto-imports `useVisitorData`,
 * `useIdentifyClient`. Server rendering never collects anything. Verify events in a server route with @trace-id/sdk-node.
 */
export default defineNuxtModule<ModuleOptions>({
  meta: { name: '@trace-id/sdk-nuxt', configKey: 'trace', compatibility: { nuxt: '>=3.13.0' } },
  defaults: {},
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    // Public runtime config only: the secret key never belongs here (see the server route in the docs).
    const pub = nuxt.options.runtimeConfig.public as Record<string, unknown>;
    pub.traceKey = pub.traceKey || options.apiKey || '';
    pub.traceEndpoint = pub.traceEndpoint || options.endpoint || '';

    addPlugin({ src: resolve('./runtime/plugin.client'), mode: 'client' });
    addImports([
      { name: 'useVisitorData', from: '@trace-id/sdk-vue' },
      { name: 'useIdentifyClient', from: '@trace-id/sdk-vue' },
    ]);
  },
});
