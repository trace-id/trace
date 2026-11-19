# Trace (Flutter)

Flutter SDK: identify a device and its app install, then verify the event on your server. Android and iOS.

**Status.** The core (`package:trace_device/trace_device.dart`) is plain Dart: payload, component hashes and the identify call. Its tests check that the payload and the hashes are identical to what the TypeScript React Native SDK produces (`../test-vectors/native-payload.json`), which the server's tamper check relies on. The glue that reads the device through Flutter plugins (`package:trace_device/flutter.dart`) was written without a Flutter build and is **unverified**: try it in your app first.

```yaml
dependencies:
  trace_device:
    path: ../trace/sdks/flutter
  device_info_plus: ^9.0.0
  package_info_plus: ^5.0.0
  flutter_secure_storage: ^9.0.0
  crypto: ^3.0.0
```

```dart
import 'package:trace_device/flutter.dart';

final trace = createTraceClient(apiKey: 'pk_...', endpoint: 'https://id.example.com');
final result = await trace.get(linkedId: userId, tags: {'action': 'signup'});
// send result.eventId to your backend and verify it there with your secret key
```

Add `app:<bundle or application id>` to the public key's allowed origins. Never put a secret key in the app.

Without Flutter (the core only), implement `TokenStore` and pass `readDevice` yourself: `TraceClient(TraceOptions(apiKey: ..., endpoint: ...), readDevice: ..., store: ...)`.

Tests: `dart run test/native_test.dart` from this folder (no dependencies). After changing `packages/sdk-react-native/src/core.ts` or `packages/signals/src/hash.ts`, regenerate the vectors with `node sdks/test-vectors/generate-native.mjs`.
