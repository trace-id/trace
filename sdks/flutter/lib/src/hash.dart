// Component hashes. A port of cyrb53 from packages/signals/src/hash.ts: the server recomputes these from the plain
// attributes, so the result must be identical to the TypeScript one (see test/native-payload.json).
//
// Dart's int is a 64-bit integer on the VM (Android and iOS), so multiplying two unsigned 32-bit values and masking gives
// the same low 32 bits as JavaScript's Math.imul. On the web, ints are doubles and this does not hold; the package is for
// mobile.

const int _mask = 0xFFFFFFFF;

int _imul(int a, int b) => ((a & _mask) * (b & _mask)) & _mask;

int _cyrb53(String input, int seed) {
  var h1 = (0xdeadbeef ^ seed) & _mask;
  var h2 = (0x41c6ce57 ^ seed) & _mask;
  for (var i = 0; i < input.length; i++) {
    final ch = input.codeUnitAt(i); // UTF-16 code unit, like charCodeAt
    h1 = _imul(h1 ^ ch, 2654435761);
    h2 = _imul(h2 ^ ch, 1597334677);
  }
  h1 = _imul(h1 ^ (h1 >> 16), 2246822507);
  h1 = (h1 ^ _imul(h2 ^ (h2 >> 13), 3266489909)) & _mask;
  h2 = _imul(h2 ^ (h2 >> 16), 2246822507);
  h2 = (h2 ^ _imul(h1 ^ (h1 >> 13), 3266489909)) & _mask;
  return 4294967296 * (2097151 & h2) + h1;
}

/// 28 hex characters (two independent 53-bit hashes).
String hashComponent(String value) {
  return _cyrb53(value, 0x9e3779b9).toRadixString(16).padLeft(14, '0') +
      _cyrb53(value, 0x85ebca6b).toRadixString(16).padLeft(14, '0');
}
