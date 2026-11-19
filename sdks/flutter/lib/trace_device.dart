/// Flutter SDK for Trace. This library is plain Dart (no Flutter imports): the payload, the hashes and the identify call.
/// Import `package:trace_device/flutter.dart` as well to read the device through the usual Flutter plugins.
library trace_device;

export 'src/client.dart';
export 'src/hash.dart' show hashComponent;
export 'src/payload.dart' show NativeReadings, buildPayload;
