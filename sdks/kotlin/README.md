# Trace (Kotlin and Android)

Android SDK: identify a device and its app install, then verify the event on your server.

**Status.** The `core` module is plain Kotlin on the JVM: payload, component hashes, JSON and the identify call. Its tests check that the payload and the hashes are identical to what the TypeScript React Native SDK produces (`../test-vectors/native-payload.json`), which the server's tamper check relies on. The `android` module (device readings through Android APIs and Keystore token storage) was written without the Android SDK and is **unverified**: try it in your app first.

```kotlin
// build.gradle.kts of your app (until the artifacts are published, include the build or publish to mavenLocal)
dependencies { implementation(project(":trace-device-android")) }
```

```kotlin
import dev.trace.device.android.createTraceClient

val trace = createTraceClient(applicationContext, apiKey = "pk_...", endpoint = "https://id.example.com")

// blocking: call from a background thread or Dispatchers.IO
val result = trace.get(linkedId = userId, tags = mapOf("action" to "signup"))
// or with a callback
trace.getAsync(linkedId = userId) { outcome -> /* outcome.getOrNull()?.eventId */ }
// send result.eventId to your backend and verify it there with your secret key
```

Add `app:<application id>` to the public key's allowed origins. Never put a secret key in the app. No permission is requested.

Consent: `trace.disable()` stops collection, `trace.disable(forget = true)` also deletes the stored token, `trace.enable()` resumes.

Backups: the token is encrypted with a Keystore key that does not leave the device, but exclude `trace_device.xml` from Auto Backup anyway (`android:fullBackupContent` / `dataExtractionRules`), so a restore onto a new phone starts a new identity.

Tests: `gradle -p sdks/kotlin :core:run` (needs Gradle and JDK 11+), or compile `core/src` with `kotlinc` and run `dev.trace.device.TestMainKt` from this folder. After changing `packages/sdk-react-native/src/core.ts` or `packages/signals/src/hash.ts`, regenerate the vectors with `node sdks/test-vectors/generate-native.mjs`.
