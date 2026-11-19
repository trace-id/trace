# @trace-id/sdk-react-native

Device identification and app fraud signals for React Native and Expo apps, with the same `<IdentifyProvider>` and
`useVisitorData()` as `@trace-id/sdk-react`.

```sh
npx expo install @trace-id/sdk-react-native expo-application expo-crypto expo-device expo-localization expo-secure-store
```

Works in Expo Go and in development builds, with no config plugin and no native code of its own: it reads the
device through those Expo modules. Bare React Native apps can install the same modules (`npx install-expo-modules`)
or pass their own readings (see [Without Expo](#without-expo)).

## 1. Allow your app on the public key

A native app sends no `Origin`. Add `app:<bundle id>` (iOS) or `app:<application id>` (Android) to the public key's
allowed origins in the dashboard, next to your web origins:

```
https://shop.example.com
app:com.example.shop
```

The SDK names its app in an `X-Trace-App` header. Like the web origin check, this only limits which apps can use the
key: a modified app can send any header. Decisions belong on your server, with the secret key (step 3).

## 2. Identify

```tsx
import { IdentifyProvider, useVisitorData } from '@trace-id/sdk-react-native';

export default function App() {
  return (
    <IdentifyProvider apiKey="pk_..." endpoint="https://id.example.com">
      <Checkout />
    </IdentifyProvider>
  );
}

function Checkout() {
  const { getData } = useVisitorData({ immediate: false });
  async function pay() {
    const result = await getData({ linkedId: user.id, tags: { screen: 'checkout' } });
    await api.post('/pay', { ...order, eventId: result?.eventId });
  }
  // ...
}
```

`useVisitorData()` returns `{ data, error, isLoading, getData }`; with `immediate` (the default) it identifies on
mount. Errors are `IdentifyError`s with a `code` (`timeout`, `network`, `origin_not_allowed`, `rate_limited`, ...).
`useIdentifyClient()` gives the client for consent: `disable(true)` stops collection and deletes the stored token.
Outside React, use `createClient({ apiKey, endpoint })`.

## 3. Verify on your server

Same as for the web: send `eventId` to your backend and fetch the event with the secret key (`verifyEvent` from
`@trace-id/sdk-node`, or the Python, PHP or Java SDK). App events carry an `app` object (platform, OS version,
manufacturer, model, app id and version, `isDevice`, `rooted`, install time) and these signals:

| Signal | Weight | Fires when |
| --- | --- | --- |
| `emulator` | 30 | The app runs on an emulator or simulator. |
| `rootedDevice` | 20 | Root (Android) or jailbreak (iOS) heuristics match. |

All other signals that do not depend on a browser apply too: VPN by time zone, Tor, datacenter and proxy IPs,
velocity, many accounts on one device, flagged networks, replayed and tampered requests, and the fraud score.

## What it reads, and what it does not

| Reading | Source | Sent as |
| --- | --- | --- |
| Screen size and scale, memory, time zone, languages, platform | React Native, expo-device, expo-localization | Hashed components, plus the plain values (as for the web) |
| OS version, manufacturer, model, app id, version and build | expo-device, expo-application | Plain values in `app` |
| Emulator, root/jailbreak, first install time | expo-device, expo-application | Plain values in `app` |
| Install id (iOS identifierForVendor, Android ANDROID_ID) | expo-application | SHA-256 with your app id as salt; the raw id never leaves the phone, and the same phone cannot be matched across different companies' apps |

No permission is requested. The SDK does not read location, contacts, the advertising id, the IMEI or anything else
that needs consent dialogs. The visitor token is kept in the Keychain or Keystore (expo-secure-store,
this-device-only): on iOS it survives reinstalls, and a backup restored onto a new phone does not carry it over.

**Recognition.** The stored token recognises the device on every launch. After a reinstall that lost the token
(Android; on iOS when every app from your developer account was removed), the install id finds it again. Two phones
of the same model with the same settings stay separate visitors: different install ids never match.

**Not covered yet** (these need native code beyond the Expo modules): cloned apps, Frida and other hooking tools,
factory reset detection, active calls, mocked GPS and on-device VPN detection.

## Without Expo

`@trace-id/sdk-react-native/core` has the same provider and client without the Expo readers. Pass `deps` with your own
`readings()` (see `NativeReadings`), a `TokenStore` and a `randomBytes` function.
