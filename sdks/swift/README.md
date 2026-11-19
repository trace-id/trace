# Trace (Swift and iOS)

iOS SDK: identify a device and its app install, then verify the event on your server. Swift 5.7+, iOS 15+.

**Status.** The core (`Hash.swift`, `Payload.swift`, `TraceClient.swift`) is plain Foundation. Its tests check that the payload and the hashes are identical to what the TypeScript React Native SDK produces (`../test-vectors/native-payload.json`), which the server's tamper check relies on. **Nothing here has been compiled yet**: this was written without a Mac, and CI (`swift` job, macOS) runs `swift test`. The UIKit glue in `Device.swift` (device readings and Keychain storage) is additionally untested on a device. Treat the package as a draft until CI passes.

```swift
// Package.swift of your app, or Xcode: File > Add Package Dependencies (until the repository is public, use a local path)
.package(path: "../trace/sdks/swift")
```

```swift
import TraceDevice

let trace = makeTraceClient(apiKey: "pk_...", endpoint: "https://id.example.com")

let result = try await trace.get(linkedId: userId, tags: ["action": "signup"])
// send result.eventId to your backend and verify it there with your secret key
```

Add `app:<bundle identifier>` to the public key's allowed origins. Never put a secret key in the app. No permission is requested, and nothing in it triggers the App Tracking Transparency prompt: it reads no advertising identifier.

Consent: `trace.disable()` stops collection, `trace.disable(forget: true)` also deletes the stored token, `trace.enable()` resumes.

Privacy: the SDK reads the device model, OS version, screen size, physical memory, locale, time zone and the app's bundle id and version, and keeps a token in the Keychain. Declare it in your App Privacy details as "Device ID" (the visitor token) used for fraud prevention.

Tests: `swift test` from this folder. After changing `packages/sdk-react-native/src/core.ts` or `packages/signals/src/hash.ts`, regenerate the vectors with `node sdks/test-vectors/generate-native.mjs`.
