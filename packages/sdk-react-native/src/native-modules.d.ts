/**
 * The few React Native and Expo APIs this SDK calls, with the signatures copied from react-native 0.88 and Expo SDK 58
 * type definitions. Declared here so the monorepo does not install React Native (its engines exclude the Node versions
 * the rest of Trace supports); apps bring the real packages as peer dependencies. Compile-time only: not shipped.
 */

declare module 'react-native' {
  export const Platform: {
    OS: 'ios' | 'android' | 'web' | 'windows' | 'macos' | 'native';
    Version: number | string;
  };
  export const Dimensions: {
    get(dim: 'window' | 'screen'): { width: number; height: number; scale: number; fontScale: number };
  };
  export const PixelRatio: { get(): number };
}

declare module 'expo-device' {
  export const isDevice: boolean;
  export const manufacturer: string | null;
  export const modelName: string | null;
  export const totalMemory: number | null;
  export const osName: string | null;
  export const osVersion: string | null;
  export function isRootedExperimentalAsync(): Promise<boolean>;
}

declare module 'expo-application' {
  export const applicationId: string | null;
  export const nativeApplicationVersion: string | null;
  export const nativeBuildVersion: string | null;
  export function getAndroidId(): string;
  export function getIosIdForVendorAsync(): Promise<string | null>;
  export function getInstallationTimeAsync(): Promise<Date>;
}

declare module 'expo-localization' {
  export const getLocales: () => [{ languageTag: string }, ...{ languageTag: string }[]];
  export const getCalendars: () => [{ timeZone: string | null }, ...{ timeZone: string | null }[]];
}

declare module 'expo-secure-store' {
  type KeychainAccessibilityConstant = number;
  export const AFTER_FIRST_UNLOCK: KeychainAccessibilityConstant;
  export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: KeychainAccessibilityConstant;
  export function getItemAsync(key: string, options?: { keychainAccessible?: KeychainAccessibilityConstant }): Promise<string | null>;
  export function setItemAsync(key: string, value: string, options?: { keychainAccessible?: KeychainAccessibilityConstant }): Promise<void>;
  export function deleteItemAsync(key: string, options?: { keychainAccessible?: KeychainAccessibilityConstant }): Promise<void>;
}

declare module 'expo-crypto' {
  export enum CryptoDigestAlgorithm {
    SHA256 = 'SHA-256',
  }
  export function getRandomBytes(byteCount: number): Uint8Array;
  export function digestStringAsync(algorithm: CryptoDigestAlgorithm, data: string): Promise<string>;
}
