import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'payload.dart';

/// code: collection_disabled, timeout, network, invalid_api_key, origin_not_allowed, rate_limited, bad_request,
/// server_error, invalid_response.
class IdentifyException implements Exception {
  IdentifyException(this.code, this.message, [this.status, this.retryAfterSec]);

  final String code;
  final String message;
  final int? status;
  final int? retryAfterSec;

  @override
  String toString() => 'IdentifyException($code): $message';
}

/// Where the SDK keeps the visitor token: the Keychain or Keystore in an app (see lib/flutter.dart).
abstract class TokenStore {
  Future<String?> get();
  Future<void> set(String token);
  Future<void> clear();
}

/// Reads the device. The Flutter implementation is in lib/flutter.dart; tests pass a fixed one.
typedef ReadDevice = Future<NativeReadings> Function();

/// Options for [TraceClient].
class TraceOptions {
  const TraceOptions({
    required this.apiKey,
    required this.endpoint,
    this.persistToken = true,
    this.timeout = const Duration(seconds: 10),
  });

  /// Public key (pk_...). Add `app:<your bundle or application id>` to its allowed origins.
  final String apiKey;

  /// Your Trace server, for example https://id.example.com.
  final String endpoint;

  /// Keep the visitor token in secure storage so the visitor is recognised across launches. Default true.
  final bool persistToken;

  /// Request timeout. Default 10 s (mobile networks are slower than a desktop browser).
  final Duration timeout;
}

/// The identify result, without the token. [raw] holds every field the server returned.
class IdentifyResult {
  IdentifyResult(this.raw);

  final Map<String, dynamic> raw;

  String get eventId => raw['eventId'] as String;
  String get visitorId => raw['visitorId'] as String;
  String? get deviceId => raw['deviceId'] as String?;
  double get confidence => (raw['confidence'] as num).toDouble();
  double get suspectScore => ((raw['suspectScore'] ?? 0) as num).toDouble();
}

/// Collects device readings and identifies the device with your Trace server. Send [IdentifyResult.eventId] to your
/// backend and verify it there with the secret key: anything an app reports can be forged on a rooted device.
class TraceClient {
  TraceClient(
    this.options, {
    required this.readDevice,
    this.store,
    math.Random? random,
    HttpClient? httpClient,
    DateTime Function()? now,
  })  : _random = random ?? math.Random.secure(),
        _http = httpClient ?? HttpClient(),
        _now = now ?? DateTime.now {
    if (options.apiKey.startsWith('sk_')) {
      throw ArgumentError('Use a public key (pk_...) in the app; secret keys belong on your server');
    }
    _http.autoUncompress = true;
  }

  final TraceOptions options;
  final ReadDevice readDevice;
  final TokenStore? store;
  final math.Random _random;
  final HttpClient _http;
  final DateTime Function() _now;
  bool _enabled = true;

  /// Consent: stop collecting until [enable]; with [forget], also delete the stored token.
  Future<void> disable({bool forget = false}) async {
    _enabled = false;
    if (forget) await store?.clear();
  }

  void enable() => _enabled = true;

  /// Identifies this device. [linkedId] is your user or account id (never an email or a name); [tags] are up to 10
  /// short values returned with the event.
  Future<IdentifyResult> get({String? linkedId, Map<String, dynamic>? tags}) async {
    if (!_enabled) throw IdentifyException('collection_disabled', 'Collection is disabled');
    final started = _now();
    final persist = options.persistToken && store != null;
    final readings = await readDevice();
    String? token;
    if (persist) {
      try {
        token = await store!.get();
      } catch (_) {
        token = null;
      }
    }

    final body = <String, dynamic>{
      'signals': buildPayload(readings, _now().difference(started).inMilliseconds),
      'sdk': <String, String>{'name': 'trace_device', 'version': '0.1.0'},
      if (token != null) 'token': token,
      if (linkedId != null) 'linkedId': linkedId,
      if (tags != null) 'tags': tags,
      'sentAt': _now().millisecondsSinceEpoch,
      'nonce': _hex(16),
    };

    final uri = Uri.parse('${options.endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/identify')
        .replace(queryParameters: <String, String>{'apiKey': options.apiKey});
    int status;
    String text;
    Map<String, String> headers = const {};
    try {
      final req = await _http.postUrl(uri).timeout(options.timeout);
      // No Origin from a native app: the server checks this id against the key's app:<id> entries.
      req.headers.set('Content-Type', 'text/plain');
      if (readings.appId != null) req.headers.set('X-Trace-App', readings.appId!);
      req.followRedirects = false;
      req.write(jsonEncode(body));
      final res = await req.close().timeout(options.timeout);
      status = res.statusCode;
      final retry = res.headers.value('retry-after');
      if (retry != null) headers = {'retry-after': retry};
      text = await res.transform(utf8.decoder).join().timeout(options.timeout);
    } on TimeoutException {
      throw IdentifyException('timeout', 'Request timed out');
    } on SocketException catch (e) {
      throw IdentifyException('network', e.message);
    } on HttpException catch (e) {
      throw IdentifyException('network', e.message);
    } on HandshakeException catch (e) {
      throw IdentifyException('network', e.message);
    }

    Object? json;
    try {
      json = jsonDecode(text);
    } catch (_) {
      json = null;
    }
    if (status < 200 || status >= 300) {
      String? serverCode;
      String? serverMessage;
      if (json is Map && json['error'] is Map) {
        final err = json['error'] as Map;
        serverCode = err['code'] is String ? err['code'] as String : null;
        serverMessage = err['message'] is String ? err['message'] as String : null;
      }
      final retryAfter = int.tryParse(headers['retry-after'] ?? '');
      throw IdentifyException(_codeFor(status, serverCode), serverMessage ?? 'HTTP $status', status, (retryAfter ?? 0) > 0 ? retryAfter : null);
    }
    if (json is! Map<String, dynamic> ||
        json['eventId'] is! String ||
        json['visitorId'] is! String ||
        json['token'] is! String ||
        json['confidence'] is! num) {
      throw IdentifyException('invalid_response', 'Unexpected response shape', status);
    }
    if (persist) {
      try {
        await store!.set(json['token'] as String);
      } catch (_) {}
    }
    final result = Map<String, dynamic>.from(json)..remove('token');
    return IdentifyResult(result);
  }

  String _hex(int bytes) => List<String>.generate(bytes, (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();

  static String _codeFor(int status, String? serverCode) {
    if (status == 401) return 'invalid_api_key';
    if (status == 403) return serverCode == 'origin_not_allowed' ? 'origin_not_allowed' : 'invalid_api_key';
    if (status == 429) return 'rate_limited';
    if (status >= 400 && status < 500) return 'bad_request';
    return 'server_error';
  }

  /// Releases the HTTP client.
  void close() => _http.close(force: true);
}
