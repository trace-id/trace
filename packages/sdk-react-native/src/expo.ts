import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { Dimensions, Platform } from 'react-native';
import { type ClientDeps, type TokenStore } from './client.js';
import { type NativeReadings } from './core.js';

const TOKEN_KEY = 'trace_visitor_token';

/** Reads the device through Expo modules. Nothing here asks for a permission. */
export async function readDevice(): Promise<NativeReadings> {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const appId = Application.applicationId;
  const screen = Dimensions.get('screen');
  const [rooted, installedAt, rawInstallId] = await Promise.all([
    Device.isRootedExperimentalAsync().catch(() => null),
    Application.getInstallationTimeAsync()
      .then((d) => d.getTime())
      .catch(() => null),
    platform === 'ios' ? Application.getIosIdForVendorAsync().catch(() => null) : Promise.resolve(safe(() => Application.getAndroidId())),
  ]);
  // The raw install id never leaves the device: it is hashed with the app id, so the same phone cannot be matched
  // across different companies' apps.
  const installIdHash = rawInstallId ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${appId ?? ''}|${rawInstallId}`) : null;
  return {
    platform,
    osVersion: Device.osVersion,
    manufacturer: Device.manufacturer,
    model: Device.modelName,
    screen: screen ? { width: screen.width, height: screen.height, scale: screen.scale } : null,
    totalMemoryBytes: Device.totalMemory,
    timezone: safe(() => Localization.getCalendars()[0]?.timeZone ?? null),
    languages: safe(() => Localization.getLocales().map((l) => l.languageTag)) ?? [],
    appId,
    appVersion: Application.nativeApplicationVersion,
    buildVersion: Application.nativeBuildVersion,
    isDevice: Device.isDevice,
    rooted,
    installedAt,
    installIdHash,
  };
}

function safe<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * The visitor token in the Keychain (iOS: survives reinstalls) or Keystore-backed storage (Android). This-device-only,
 * so a backup restored onto a new phone does not carry it over: a new phone is a new device.
 */
export const secureTokenStore: TokenStore = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  set: (token) => SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
};

export const expoDeps: ClientDeps = {
  readings: readDevice,
  store: secureTokenStore,
  randomBytes: (n) => Crypto.getRandomBytes(n),
};
