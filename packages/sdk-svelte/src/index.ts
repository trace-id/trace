import { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
import { IdentifyError } from '@trace-id/sdk-js/errors';

export { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
export { IdentifyError } from '@trace-id/sdk-js/errors';

export interface VisitorDataState {
  data: IdentifyResult | null;
  error: IdentifyError | null;
  isLoading: boolean;
}

/**
 * A Svelte store (any value with subscribe) of the identification state. No Svelte import is needed, so the same store
 * also works with Angular's async pipe, Solid, or plain callbacks.
 */
export interface VisitorDataStore {
  subscribe(run: (state: VisitorDataState) => void): () => void;
  /** Collects and identifies now. Resolves with the result; on failure resolves null and sets `error`. */
  getData(options?: GetOptions): Promise<IdentifyResult | null>;
  /** The underlying client, for consent toggles (enable(), disable(true)). */
  client: Client;
}

export interface VisitorDataOptions extends GetOptions {
  /** Identify as soon as the first subscriber arrives (in the browser). Default true. */
  immediate?: boolean;
}

function toIdentifyError(err: unknown): IdentifyError {
  return err instanceof IdentifyError ? err : new IdentifyError('network', err instanceof Error ? err.message : 'Unknown error');
}

/**
 * `const visitor = createVisitorData({ apiKey, endpoint });` then `$visitor.data?.visitorId` in a component. Send
 * `data.eventId` to your backend and verify it there.
 */
export function createVisitorData(options: ClientOptions | Client, defaults: VisitorDataOptions = {}): VisitorDataStore {
  const client = options instanceof Client ? options : new Client(options);
  const { immediate = true, ...getDefaults } = defaults;
  let state: VisitorDataState = { data: null, error: null, isLoading: immediate && typeof window !== 'undefined' };
  const subscribers = new Set<(s: VisitorDataState) => void>();
  let latest = 0;
  let started = false;

  const set = (patch: Partial<VisitorDataState>) => {
    state = { ...state, ...patch };
    for (const run of subscribers) run(state);
  };

  const getData = async (override?: GetOptions): Promise<IdentifyResult | null> => {
    const call = ++latest;
    set({ isLoading: true, error: null });
    try {
      const result = await client.get({ ...getDefaults, ...override });
      if (call === latest) set({ data: result, isLoading: false });
      return result;
    } catch (err) {
      if (call === latest) set({ error: toIdentifyError(err), isLoading: false });
      return null;
    }
  };

  return {
    client,
    getData,
    subscribe(run) {
      subscribers.add(run);
      run(state);
      // Collection only runs in a browser, never during server-side rendering.
      if (!started && immediate && typeof window !== 'undefined') {
        started = true;
        void getData();
      }
      return () => subscribers.delete(run);
    },
  };
}
