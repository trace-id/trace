import { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
import { IdentifyError } from '@trace-id/sdk-js/errors';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const ClientContext = createContext<Client | null>(null);

export interface IdentifyProviderProps extends ClientOptions {
  children: ReactNode;
}

/**
 * Creates one SDK client for the subtree. Options are read once; remount the provider (for
 * example with a `key`) to change the key or endpoint. Collection never runs during SSR.
 */
export function IdentifyProvider({ children, ...options }: IdentifyProviderProps) {
  const [client] = useState(() => new Client(options));
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

/** The underlying client, for consent toggles (`enable()`, `disable(true)`). */
export function useIdentifyClient(): Client {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useIdentifyClient must be used inside <IdentifyProvider>');
  return client;
}

export interface UseVisitorDataOptions extends GetOptions {
  /** Run once on mount. Default true. Set false to call getData() yourself, e.g. on submit. */
  immediate?: boolean;
}

export interface VisitorDataState {
  data: IdentifyResult | null;
  error: IdentifyError | null;
  isLoading: boolean;
  /** Collects and identifies now. Resolves with the result; on failure resolves null and sets `error`. */
  getData: (options?: GetOptions) => Promise<IdentifyResult | null>;
}

function toIdentifyError(err: unknown): IdentifyError {
  return err instanceof IdentifyError ? err : new IdentifyError('network', err instanceof Error ? err.message : 'Unknown error');
}

/**
 * Send `data.eventId` to your backend and verify it there; never trust `visitorId` or the
 * score from the browser on their own.
 */
export function useVisitorData(options: UseVisitorDataOptions = {}): VisitorDataState {
  const client = useIdentifyClient();
  const { immediate = true, linkedId, tags } = options;
  const [data, setData] = useState<IdentifyResult | null>(null);
  const [error, setError] = useState<IdentifyError | null>(null);
  const [isLoading, setLoading] = useState(immediate);
  const mounted = useRef(true);
  const latest = useRef(0);
  // Tags are compared by value so an inline object literal does not refetch every render.
  const tagsKey = JSON.stringify(tags ?? null);
  const defaults = useMemo<GetOptions>(() => {
    const parsedTags = JSON.parse(tagsKey) as GetOptions['tags'] | null;
    return { ...(linkedId !== undefined ? { linkedId } : {}), ...(parsedTags ? { tags: parsedTags } : {}) };
  }, [linkedId, tagsKey]);

  const getData = useCallback(
    async (override?: GetOptions): Promise<IdentifyResult | null> => {
      const call = ++latest.current;
      setLoading(true);
      setError(null);
      try {
        const result = await client.get({ ...defaults, ...override });
        if (mounted.current && call === latest.current) setData(result);
        return result;
      } catch (err) {
        if (mounted.current && call === latest.current) setError(toIdentifyError(err));
        return null;
      } finally {
        if (mounted.current && call === latest.current) setLoading(false);
      }
    },
    [client, defaults],
  );

  useEffect(() => {
    mounted.current = true;
    if (immediate) void getData();
    return () => {
      mounted.current = false;
    };
  }, [immediate, getData]);

  return { data, error, isLoading, getData };
}
