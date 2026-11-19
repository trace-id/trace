import { beforeEach, describe, expect, it, vi } from 'vitest';

const addPlugin = vi.fn();
const addImports = vi.fn();

// The real kit needs a running Nuxt; the module only calls these three helpers, so stand-ins are enough to test its logic.
vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: (definition: unknown) => definition,
  addPlugin: (...args: unknown[]) => addPlugin(...args),
  addImports: (...args: unknown[]) => addImports(...args),
  createResolver: () => ({ resolve: (p: string) => `/module/${p}` }),
}));

interface Definition {
  meta: { name: string; configKey: string };
  defaults: Record<string, unknown>;
  setup: (options: { apiKey?: string; endpoint?: string }, nuxt: { options: { runtimeConfig: { public: Record<string, unknown> } } }) => void;
}

async function load(): Promise<Definition> {
  return (await import('./module.js')).default as unknown as Definition;
}

function nuxtWith(pub: Record<string, unknown> = {}) {
  return { options: { runtimeConfig: { public: pub } } };
}

describe('@trace-id/sdk-nuxt module', () => {
  beforeEach(() => {
    addPlugin.mockClear();
    addImports.mockClear();
  });

  it('is configured under the trace key', async () => {
    const m = await load();
    expect(m.meta).toMatchObject({ name: '@trace-id/sdk-nuxt', configKey: 'trace' });
  });

  it('puts the public key and endpoint into public runtime config', async () => {
    const nuxt = nuxtWith();
    (await load()).setup({ apiKey: 'pk_test_fake', endpoint: 'https://id.example.test' }, nuxt);
    expect(nuxt.options.runtimeConfig.public).toMatchObject({ traceKey: 'pk_test_fake', traceEndpoint: 'https://id.example.test' });
  });

  it('does not override values already set, such as from NUXT_PUBLIC_TRACE_KEY', async () => {
    const nuxt = nuxtWith({ traceKey: 'pk_from_env', traceEndpoint: 'https://env.example.test' });
    (await load()).setup({ apiKey: 'pk_test_fake', endpoint: 'https://id.example.test' }, nuxt);
    expect(nuxt.options.runtimeConfig.public).toMatchObject({ traceKey: 'pk_from_env', traceEndpoint: 'https://env.example.test' });
  });

  it('leaves the config empty rather than inventing a key', async () => {
    const nuxt = nuxtWith();
    (await load()).setup({}, nuxt);
    expect(nuxt.options.runtimeConfig.public).toMatchObject({ traceKey: '', traceEndpoint: '' });
  });

  it('registers a client-only plugin, so nothing is collected during server rendering', async () => {
    (await load()).setup({}, nuxtWith());
    expect(addPlugin).toHaveBeenCalledTimes(1);
    expect(addPlugin.mock.calls[0]![0]).toMatchObject({ mode: 'client' });
  });

  it('auto-imports the composables from the Vue bindings', async () => {
    (await load()).setup({}, nuxtWith());
    const imports = addImports.mock.calls[0]![0] as { name: string; from: string }[];
    expect(imports.map((i) => i.name)).toEqual(['useVisitorData', 'useIdentifyClient']);
    expect(imports.every((i) => i.from === '@trace-id/sdk-vue')).toBe(true);
  });

  it('never puts a secret key anywhere: the module has no secret option', async () => {
    const m = await load();
    expect(Object.keys(m.defaults)).not.toContain('secretKey');
  });
});
