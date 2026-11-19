import { Client, type ClientDeps, type ClientOptions } from './client.js';
import { expoDeps } from './expo.js';
import { IdentifyProvider as BaseProvider, type IdentifyProviderProps as BaseProps } from './provider.js';

export { useIdentifyClient, useVisitorData, type UseVisitorDataOptions, type VisitorDataState } from './provider.js';
export { Client, type ClientDeps, type ClientOptions, type GetOptions, type IdentifyResult, type TokenStore } from './client.js';
export { IdentifyError, type IdentifyErrorCode } from '@trace-id/sdk-js/errors';
export { readDevice, secureTokenStore } from './expo.js';

export type IdentifyProviderProps = Omit<BaseProps, 'deps'> & { deps?: ClientDeps };

/**
 * Wrap your app (or the screens that need it):
 *
 *   <IdentifyProvider apiKey="pk_..." endpoint="https://id.example.com">
 *
 * Reads the device through Expo modules; pass `deps` to replace them.
 */
export function IdentifyProvider({ deps, ...props }: IdentifyProviderProps) {
  return <BaseProvider {...props} deps={deps ?? expoDeps} />;
}

/** A client outside React, e.g. in a payment service module. */
export function createClient(options: ClientOptions, deps: ClientDeps = expoDeps): Client {
  return new Client(options, deps);
}
