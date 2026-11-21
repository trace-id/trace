import { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
import { IdentifyError } from '@trace-id/sdk-js/errors';
import { VIA } from './via.js';
import {
  type Accessor,
  type Component,
  createComponent,
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  splitProps,
  untrack,
  useContext,
} from 'solid-js';

export { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
export { IdentifyError } from '@trace-id/sdk-js/errors';

const ClientContext = createContext<Client>();

export type IdentifyProviderProps = ClientOptions & { children?: JSX.Element };

/**
 * One SDK client for the subtree. Options are read once; remount the provider to change the key or endpoint.
 * Collection never runs during server rendering.
 */
export const IdentifyProvider: Component<IdentifyProviderProps> = (props) => {
  // splitProps keeps `children` lazy: spreading props would render the subtree before the context exists.
  const [, options] = splitProps(props, ['children']);
  const client = new Client(untrack(() => ({ ...options, via: options.via ?? VIA })));
  return createComponent(ClientContext.Provider, {
    value: client,
    get children() {
      return props.children;
    },
  });
};

/** The underlying client, for consent toggles (`enable()`, `disable(true)`). */
export function useIdentifyClient(): Client {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useIdentifyClient must be used inside <IdentifyProvider>');
  return client;
}

export interface VisitorDataOptions extends GetOptions {
  /** Identify when the component mounts in the browser. Default true. Set false to call getData() yourself, e.g. on submit. */
  immediate?: boolean;
}

export interface VisitorData {
  data: Accessor<IdentifyResult | null>;
  error: Accessor<IdentifyError | null>;
  isLoading: Accessor<boolean>;
  /** Collects and identifies now. Resolves with the result; on failure resolves null and sets `error()`. */
  getData: (options?: GetOptions) => Promise<IdentifyResult | null>;
}

function toIdentifyError(err: unknown): IdentifyError {
  return err instanceof IdentifyError ? err : new IdentifyError('network', err instanceof Error ? err.message : 'Unknown error');
}

/**
 * Signals for one component. Call it in a component body. Send `data().eventId` to your backend and verify it there;
 * never trust the browser result on its own.
 *
 *     const visitor = createVisitorData({ immediate: false });
 */
export function createVisitorData(options: VisitorDataOptions = {}): VisitorData {
  const client = useIdentifyClient();
  const { immediate = true, ...defaults } = options;
  const [data, setData] = createSignal<IdentifyResult | null>(null);
  const [error, setError] = createSignal<IdentifyError | null>(null);
  const [isLoading, setLoading] = createSignal(immediate);
  let latest = 0;
  let alive = true;
  onCleanup(() => {
    alive = false;
  });

  const getData = async (override?: GetOptions): Promise<IdentifyResult | null> => {
    const call = ++latest;
    setLoading(true);
    setError(null);
    try {
      const result = await client.get({ ...defaults, ...override });
      if (alive && call === latest) setData(result);
      return result;
    } catch (err) {
      if (alive && call === latest) setError(toIdentifyError(err));
      return null;
    } finally {
      if (alive && call === latest) setLoading(false);
    }
  };

  // onMount never runs during server-side rendering, so collection stays in the browser.
  onMount(() => {
    if (immediate) void getData();
  });

  return { data, error, isLoading, getData };
}
