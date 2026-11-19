// Flutter glue: reads the device through device_info_plus, package_info_plus and flutter_secure_storage, and keeps the
// visitor token in the Keychain or Keystore. UNVERIFIED: written without a Flutter toolchain build, so check it in your
// app. Add these to your app's pubspec: device_info_plus, package_info_plus, flutter_secure_storage, crypto.
//
//   final trace = createTraceClient(apiKey: 'pk_...', endpoint: 'https://id.example.com');
//   final result = await trace.get(linkedId: userId, tags: {'action': 'signup'});
//   // send result.eventId to your backend and verify it there with your secret key
import 'dart:io' show Platform;
import 'dart:ui' show PlatformDispatcher;

import 'package:crypto/crypto.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'src/client.dart';
import 'src/payload.dart';

const _tokenKey = 'trace_visitor_token';

/// The visitor token in the Keychain (iOS) or Keystore-backed storage (Android). This-device-only on iOS, so a backup
/// restored onto a new phone does not carry it over: a new phone is a new device.
class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> get() => _storage.read(key: _tokenKey);

  @override
  Future<void> set(String token) => _storage.write(key: _tokenKey, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _tokenKey);
}

/// Reads the device. Nothing here asks for a permission. The install id never leaves the device raw: it is hashed with the
/// app id, so the same phone cannot be matched across different companies' apps.
Future<NativeReadings> readDevice() async {
  final isIos = Platform.isIOS;
  final package = await PackageInfo.fromPlatform();
  final info = DeviceInfoPlugin();
  String? osVersion;
  String? manufacturer;
  String? model;
  bool? isDevice;
  String? rawInstallId;
  if (isIos) {
    final ios = await info.iosInfo;
    osVersion = ios.systemVersion;
    manufacturer = 'Apple';
    model = ios.utsname.machine;
    isDevice = ios.isPhysicalDevice;
    rawInstallId = ios.identifierForVendor;
  } else {
    final android = await info.androidInfo;
    osVersion = android.version.release;
    manufacturer = android.manufacturer;
    model = android.model;
    isDevice = android.isPhysicalDevice;
    // The Android install id (ANDROID_ID) needs a platform channel the plugins above do not expose; the app id and
    // version already separate installs for most purposes. Left null rather than guessed.
    rawInstallId = null;
  }

  final view = PlatformDispatcher.instance.views.isNotEmpty ? PlatformDispatcher.instance.views.first : null;
  final scale = view?.devicePixelRatio;
  final size = view?.physicalSize;
  final locales = PlatformDispatcher.instance.locales.map((l) => l.toLanguageTag()).toList();

  return NativeReadings(
    platform: isIos ? 'ios' : 'android',
    osVersion: osVersion,
    manufacturer: manufacturer,
    model: model,
    screenWidth: size != null && scale != null && scale > 0 ? size.width / scale : null,
    screenHeight: size != null && scale != null && scale > 0 ? size.height / scale : null,
    screenScale: scale,
    totalMemoryBytes: null, // not readable without native code
    // An abbreviation such as CET: Dart has no IANA zone name. Pass an IANA id (for example from flutter_timezone) by
    // copying this reading into your own NativeReadings if you need the exact zone.
    timezone: DateTime.now().timeZoneName,
    languages: locales,
    appId: package.packageName,
    appVersion: package.version,
    buildVersion: package.buildNumber,
    isDevice: isDevice,
    rooted: null, // not readable without native code
    installedAtMs: null,
    installIdHash: rawInstallId == null ? null : sha256.convert('${package.packageName}|$rawInstallId'.codeUnits).toString(),
  );
}

/// A ready-to-use client: device readings through the Flutter plugins and the token in secure storage.
TraceClient createTraceClient({required String apiKey, required String endpoint, bool persistToken = true}) {
  return TraceClient(
    TraceOptions(apiKey: apiKey, endpoint: endpoint, persistToken: persistToken),
    readDevice: readDevice,
    store: SecureTokenStore(),
  );
}
