import { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
import { IdentifyError } from '@trace-id/sdk-js/errors';
import { VIA } from './via.js';
import { type App, type InjectionKey, inject, onMounted, type Ref, ref, shallowRef } from 'vue';

export { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
export { IdentifyError } from '@trace-id/sdk-js/errors';

const CLIENT: InjectionKey<Client> = Symbol('trace-client');

/** `app.use(createIdentify({ apiKey, endpoint }))`: one SDK client for the whole app. */
export function createIdentify(options: ClientOptions) {
  return {
    install(app: App) {
      app.provide(CLIENT, new Client({ ...options, via: options.via ?? VIA }));
    },
  };
}

/** The underlying client, for consent toggles (enable(), disable(true)). */
export function useIdentifyClient(): Client {
  const client = inject(CLIENT, null);
  if (!client) throw new Error('useIdentifyClient needs app.use(createIdentify(...))');
  return client;
}

export interface UseVisitorDataOptions extends GetOptions {
  /** Identify when the component mounts. Default true. Set false to call getData() yourself, e.g. on submit. */
  immediate?: boolean;
}

export interface VisitorData {
  data: Ref<IdentifyResult | null>;
  error: Ref<IdentifyError | null>;
  isLoading: Ref<boolean>;
  /** Collects and identifies now. Resolves with the result; on failure resolves null and sets `error`. */
  getData: (options?: GetOptions) => Promise<IdentifyResult | null>;
}

function toIdentifyError(err: unknown): IdentifyError {
  return err instanceof IdentifyError ? err : new IdentifyError('network', err instanceof Error ? err.message : 'Unknown error');
}

/** Send `data.value.eventId` to your backend and verify it there; never trust the browser result on its own. */
export function useVisitorData(options: UseVisitorDataOptions = {}): VisitorData {
  const client = useIdentifyClient();
  const { immediate = true, ...defaults } = options;
  const data = shallowRef<IdentifyResult | null>(null);
  const error = shallowRef<IdentifyError | null>(null);
  const isLoading = ref(immediate);
  let latest = 0;

  const getData = async (override?: GetOptions): Promise<IdentifyResult | null> => {
    const call = ++latest;
    isLoading.value = true;
    error.value = null;
    try {
      const result = await client.get({ ...defaults, ...override });
      if (call === latest) data.value = result;
      return result;
    } catch (err) {
      if (call === latest) error.value = toIdentifyError(err);
      return null;
    } finally {
      if (call === latest) isLoading.value = false;
    }
  };

  // onMounted never runs during server-side rendering, so collection stays in the browser.
  onMounted(() => {
    if (immediate) void getData();
  });

  return { data, error, isLoading, getData };
}
