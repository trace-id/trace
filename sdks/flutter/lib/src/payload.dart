import 'dart:convert';
import 'dart:math' as math;

import 'hash.dart';

/// Everything the SDK reads on the device. Any value can be null when the platform cannot say.
class NativeReadings {
  const NativeReadings({
    required this.platform,
    this.osVersion,
    this.manufacturer,
    this.model,
    this.screenWidth,
    this.screenHeight,
    this.screenScale,
    this.totalMemoryBytes,
    this.timezone,
    this.languages = const <String>[],
    this.appId,
    this.appVersion,
    this.buildVersion,
    this.isDevice,
    this.rooted,
    this.installedAtMs,
    this.installIdHash,
  });

  /// 'ios' or 'android'.
  final String platform;
  final String? osVersion;
  final String? manufacturer;
  final String? model;

  /// Physical screen in logical points.
  final double? screenWidth;
  final double? screenHeight;
  final double? screenScale;
  final int? totalMemoryBytes;
  final String? timezone;
  final List<String> languages;
  final String? appId;
  final String? appVersion;
  final String? buildVersion;
  final bool? isDevice;
  final bool? rooted;
  final int? installedAtMs;

  /// SHA-256 hex of the platform install id (IDFV or ANDROID_ID) salted with the app id; null when unavailable.
  final String? installIdHash;

  /// Reads one case of test/native-payload.json (the readings the TypeScript SDK was given).
  factory NativeReadings.fromJson(Map<String, dynamic> j) {
    final screen = j['screen'] as Map<String, dynamic>?;
    return NativeReadings(
      platform: j['platform'] as String,
      osVersion: j['osVersion'] as String?,
      manufacturer: j['manufacturer'] as String?,
      model: j['model'] as String?,
      screenWidth: (screen?['width'] as num?)?.toDouble(),
      screenHeight: (screen?['height'] as num?)?.toDouble(),
      screenScale: (screen?['scale'] as num?)?.toDouble(),
      totalMemoryBytes: (j['totalMemoryBytes'] as num?)?.toInt(),
      timezone: j['timezone'] as String?,
      languages: (j['languages'] as List<dynamic>).cast<String>(),
      appId: j['appId'] as String?,
      appVersion: j['appVersion'] as String?,
      buildVersion: j['buildVersion'] as String?,
      isDevice: j['isDevice'] as bool?,
      rooted: j['rooted'] as bool?,
      installedAtMs: (j['installedAt'] as num?)?.toInt(),
      installIdHash: j['installIdHash'] as String?,
    );
  }
}

/// A number the way JavaScript prints it: whole values without a trailing ".0".
String _js(num n) => n == n.truncate() && n.abs() < 1e21 ? n.truncate().toString() : n.toString();

String _orEmpty(Object? v) => v == null ? '' : (v is num ? _js(v) : v.toString());

/// Builds the identify payload (the `signals` field). Components that the browser SDK derives from attributes are
/// derived the same way, so the server's integrity check passes for an untouched app.
Map<String, dynamic> buildPayload(NativeReadings r, [int collectMs = 0]) {
  final memoryGb = r.totalMemoryBytes != null && r.totalMemoryBytes! > 0
      ? (r.totalMemoryBytes! / 1073741824 * 4).roundToDouble() / 4
      : null;
  final width = r.screenWidth?.round();
  final height = r.screenHeight?.round();
  final languages = r.languages.take(10).toList();
  final platformName = r.platform == 'ios' ? 'iOS' : 'Android';

  final attributes = <String, dynamic>{
    'screenWidth': width,
    'screenHeight': height,
    'availWidth': null,
    'availHeight': null,
    'colorDepth': null,
    'pixelRatio': r.screenScale == null ? null : (r.screenScale == r.screenScale!.truncate() ? r.screenScale!.truncate() : r.screenScale),
    'hardwareConcurrency': null,
    'deviceMemory': memoryGb == null ? null : (memoryGb == memoryGb.truncate() ? memoryGb.truncate() : memoryGb),
    'maxTouchPoints': 5,
    'timezone': r.timezone,
    'languages': languages,
    'platform': platformName,
    'userAgent': null,
    'uaBrands': <String>[],
    'uaMobile': true,
    'uaPlatform': null,
    'webglVendor': null,
    'webglRenderer': null,
  };

  // The same inputs packages/signals/src/integrity.ts derives, with touch = true.
  final components = <String, String>{};
  if (width != null && height != null) {
    final long = math.max(width, height);
    final short = math.min(width, height);
    components['screen'] = hashComponent('${long}x$short|${_orEmpty(attributes['colorDepth'])}|${_orEmpty(attributes['pixelRatio'])}');
  }
  if (r.timezone != null && r.timezone!.isNotEmpty) components['timezone'] = hashComponent(r.timezone!);
  if (languages.isNotEmpty) components['languages'] = hashComponent(languages.join(','));
  components['platform'] = hashComponent('[${jsonEncode(platformName)},null]');
  components['hardware'] = hashComponent('|${_orEmpty(attributes['deviceMemory'])}|5|true');
  final osMajor = r.osVersion == null ? '' : r.osVersion!.split('.').first;
  components['userAgentFamily'] = hashComponent('app|${r.platform}|$osMajor');
  if (r.installIdHash != null && r.installIdHash!.isNotEmpty) {
    components['appInstall'] = r.installIdHash!.substring(0, math.min(28, r.installIdHash!.length));
  }

  return <String, dynamic>{
    'v': 1,
    'components': components,
    'attributes': attributes,
    'bot': <String, dynamic>{
      'webdriver': false,
      'headlessUserAgent': false,
      'automationGlobals': <String>[],
      'noPlugins': false,
      'noLanguages': false,
      'permissionsInconsistent': false,
      'chromeObjectMissing': false,
      'zeroOuterSize': false,
    },
    'tamper': <String, dynamic>{
      'nativeOverrides': <String>[],
      'navigatorOwnProperties': <String>[],
      'uaPlatformMismatch': false,
      'uaFeatureMismatch': false,
      'canvasNoise': false,
    },
    'privacy': <String, dynamic>{'incognitoLikely': false, 'incognitoMethod': null, 'storageQuotaMb': null},
    'storage': <String, dynamic>{'cookie': false, 'localStorage': false, 'indexedDb': false},
    'app': <String, dynamic>{
      'platform': r.platform,
      'osVersion': r.osVersion,
      'manufacturer': r.manufacturer,
      'model': r.model,
      'appId': r.appId,
      'appVersion': r.appVersion,
      'buildVersion': r.buildVersion,
      'isDevice': r.isDevice,
      'rooted': r.rooted,
      'installedAt': r.installedAtMs,
    },
    'collectMs': collectMs,
  };
}
