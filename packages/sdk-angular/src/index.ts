import {
  afterNextRender,
  DestroyRef,
  type EnvironmentProviders,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  type Signal,
  signal,
} from '@angular/core';
import { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
import { IdentifyError } from '@trace-id/sdk-js/errors';
import { VIA } from './via.js';

export { Client, type ClientOptions, type GetOptions, type IdentifyResult } from '@trace-id/sdk-js';
export { IdentifyError } from '@trace-id/sdk-js/errors';

const CLIENT = new InjectionToken<Client>('TRACE_CLIENT');

/**
 * One SDK client for the whole app. Add it to `bootstrapApplication(App, { providers: [provideTrace({ apiKey, endpoint })] })`.
 * Options are read once.
 */
export function provideTrace(options: ClientOptions): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: CLIENT, useFactory: () => new Client({ ...options, via: options.via ?? VIA }) }]);
}

/** The underlying client, for consent toggles (`enable()`, `disable(true)`). Call in an injection context. */
export function injectTraceClient(): Client {
  const client = inject(CLIENT, { optional: true });
  if (!client) throw new Error('injectTraceClient needs provideTrace(...) in your providers');
  return client;
}

export interface VisitorDataOptions extends GetOptions {
  /** Identify once the component has rendered in the browser. Default true. Set false to call getData() yourself, e.g. on submit. */
  immediate?: boolean;
}

export interface VisitorData {
  data: Signal<IdentifyResult | null>;
  error: Signal<IdentifyError | null>;
  isLoading: Signal<boolean>;
  /** Collects and identifies now. Resolves with the result; on failure resolves null and sets `error`. */
  getData: (options?: GetOptions) => Promise<IdentifyResult | null>;
}

function toIdentifyError(err: unknown): IdentifyError {
  return err instanceof IdentifyError ? err : new IdentifyError('network', err instanceof Error ? err.message : 'Unknown error');
}

/**
 * Signals for one component. Call it in a field initialiser or constructor (an injection context).
 * Send `data().eventId` to your backend and verify it there; never trust the browser result on its own.
 *
 *     readonly visitor = injectVisitorData({ linkedId: userId });
 */
export function injectVisitorData(options: VisitorDataOptions = {}): VisitorData {
  const client = injectTraceClient();
  const destroyRef = inject(DestroyRef);
  const { immediate = true, ...defaults } = options;
  const data = signal<IdentifyResult | null>(null);
  const error = signal<IdentifyError | null>(null);
  const isLoading = signal(immediate);
  let latest = 0;
  let alive = true;
  destroyRef.onDestroy(() => {
    alive = false;
  });

  const getData = async (override?: GetOptions): Promise<IdentifyResult | null> => {
    const call = ++latest;
    isLoading.set(true);
    error.set(null);
    try {
      const result = await client.get({ ...defaults, ...override });
      if (alive && call === latest) data.set(result);
      return result;
    } catch (err) {
      if (alive && call === latest) error.set(toIdentifyError(err));
      return null;
    } finally {
      if (alive && call === latest) isLoading.set(false);
    }
  };

  // afterNextRender never runs during server-side rendering, so collection stays in the browser.
  if (immediate) afterNextRender(() => void getData());

  return { data: data.asReadonly(), error: error.asReadonly(), isLoading: isLoading.asReadonly(), getData };
}
