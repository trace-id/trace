// Dependency-free tests: dart run test/native_test.dart  (from sdks/flutter)
// The payload and hash checks compare against sdks/test-vectors/native-payload.json, produced by the TypeScript SDK, so
// the server's tamper check passes for an untouched Flutter app.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:trace_device/trace_device.dart';

var passed = 0;
var failures = 0;

void check(bool ok, String name) {
  if (ok) {
    passed++;
  } else {
    failures++;
    stderr.writeln('FAIL: $name');
  }
}

/// Structural equality where 3 and 3.0 are the same number (JSON from different languages).
bool same(Object? a, Object? b) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final k in a.keys) {
      if (!b.containsKey(k) || !same(a[k], b[k])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!same(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

class MemoryStore implements TokenStore {
  String? token;
  @override
  Future<String?> get() async => token;
  @override
  Future<void> set(String t) async => token = t;
  @override
  Future<void> clear() async => token = null;
}

Future<void> main() async {
  final vectorsFile = File('../test-vectors/native-payload.json');
  final vectors = jsonDecode(await vectorsFile.readAsString()) as Map<String, dynamic>;

  // Hashes
  for (final h in (vectors['hashes'] as List<dynamic>).cast<Map<String, dynamic>>()) {
    final input = h['input'] as String;
    final label = input.length > 20 ? '${input.substring(0, 20)}...' : input;
    check(hashComponent(input) == h['hash'], 'hash of "$label"');
  }

  // Payloads
  final cases = (vectors['cases'] as List<dynamic>).cast<Map<String, dynamic>>();
  for (var i = 0; i < cases.length; i++) {
    final c = cases[i];
    final readings = NativeReadings.fromJson(c['readings'] as Map<String, dynamic>);
    final built = jsonDecode(jsonEncode(buildPayload(readings, c['collectMs'] as int)));
    final expected = c['payload'];
    check(same(built, expected), 'payload case $i matches the TypeScript SDK');
    if (!same(built, expected)) {
      stderr.writeln('  built:    ${jsonEncode(built)}');
      stderr.writeln('  expected: ${jsonEncode(expected)}');
    }
  }

  // Client against a local server
  final requests = <Map<String, dynamic>>[];
  var mode = 'ok';
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  server.listen((req) async {
    final body = await utf8.decoder.bind(req).join();
    requests.add(<String, dynamic>{
      'path': req.uri.path,
      'apiKey': req.uri.queryParameters['apiKey'],
      'contentType': req.headers.contentType?.mimeType,
      'app': req.headers.value('x-trace-app'),
      'body': jsonDecode(body),
    });
    if (mode == 'slow') {
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    req.response.headers.contentType = ContentType.json;
    if (mode == 'denied') {
      req.response.statusCode = 403;
      req.response.write(jsonEncode({'error': {'code': 'origin_not_allowed', 'message': 'no'}}));
    } else if (mode == 'limited') {
      req.response.statusCode = 429;
      req.response.headers.set('Retry-After', '7');
      req.response.write(jsonEncode({'error': {'code': 'rate_limited', 'message': 'slow down'}}));
    } else if (mode == 'bad') {
      req.response.write(jsonEncode({'unexpected': true}));
    } else {
      req.response.write(jsonEncode({'eventId': 'e1', 'visitorId': 'v1', 'deviceId': 'v1', 'confidence': 0.99, 'suspectScore': 0, 'token': 'tok-1'}));
    }
    await req.response.close();
  });
  final endpoint = 'http://127.0.0.1:${server.port}';
  final readings = NativeReadings.fromJson((cases[0]['readings']) as Map<String, dynamic>);
  final store = MemoryStore();
  final client = TraceClient(
    TraceOptions(apiKey: 'pk_test', endpoint: endpoint, timeout: const Duration(milliseconds: 250)),
    readDevice: () async => readings,
    store: store,
  );

  final result = await client.get(linkedId: 'user-1', tags: {'action': 'signup'});
  check(result.eventId == 'e1' && result.visitorId == 'v1' && !result.raw.containsKey('token'), 'result has no token');
  check(store.token == 'tok-1', 'token is stored');
  final first = requests.last;
  check(first['path'] == '/v1/identify' && first['apiKey'] == 'pk_test' && first['contentType'] == 'text/plain', 'request line and content type');
  check(first['app'] == 'com.example.shop', 'X-Trace-App header');
  final body = first['body'] as Map<String, dynamic>;
  check(body['linkedId'] == 'user-1' && (body['tags'] as Map)['action'] == 'signup', 'linkedId and tags are sent');
  check((body['nonce'] as String).length == 32 && body['token'] == null && body['sentAt'] is int, 'nonce, sentAt, no token on first call');
  check((body['sdk'] as Map)['name'] == 'trace_device', 'sdk name');

  await client.get();
  check(requests.last['body']['token'] == 'tok-1', 'stored token is sent on the next call');

  Future<String> codeOf(Future<Object?> Function() fn) async {
    try {
      await fn();
      return 'ok';
    } on IdentifyException catch (e) {
      return e.code;
    }
  }

  mode = 'denied';
  check(await codeOf(() => client.get()) == 'origin_not_allowed', '403 origin_not_allowed');
  mode = 'limited';
  try {
    await client.get();
  } on IdentifyException catch (e) {
    check(e.code == 'rate_limited' && e.retryAfterSec == 7, '429 rate_limited with Retry-After');
  }
  mode = 'bad';
  check(await codeOf(() => client.get()) == 'invalid_response', 'unexpected body');
  mode = 'slow';
  check(await codeOf(() => client.get()) == 'timeout', 'timeout');
  mode = 'ok';

  await client.disable();
  check(await codeOf(() => client.get()) == 'collection_disabled', 'disabled');
  await client.disable(forget: true);
  check(store.token == null, 'disable(forget) clears the token');
  client.enable();
  check(await codeOf(() => client.get()) == 'ok', 'enable resumes');

  check(() {
    try {
      TraceClient(const TraceOptions(apiKey: 'sk_secret', endpoint: 'http://x'), readDevice: () async => readings);
      return false;
    } on ArgumentError {
      return true;
    }
  }(), 'a secret key is refused');

  client.close();
  await server.close(force: true);
  stdout.writeln('$passed passed, $failures failed');
  exit(failures == 0 ? 0 : 1);
}
