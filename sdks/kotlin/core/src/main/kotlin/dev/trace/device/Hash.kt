package dev.trace.device

// Component hashes. A port of cyrb53 from packages/signals/src/hash.ts: the server recomputes these from the plain
// attributes, so the result must be identical to the TypeScript one (see test-vectors/native-payload.json).

private const val MASK = 0xFFFFFFFFL

/** Math.imul on unsigned 32-bit values: the low 32 bits of the product, which survive 64-bit wraparound. */
private fun imul(a: Long, b: Long): Long = ((a and MASK) * (b and MASK)) and MASK

private fun cyrb53(input: String, seed: Long): Long {
    var h1 = (0xdeadbeefL xor seed) and MASK
    var h2 = (0x41c6ce57L xor seed) and MASK
    for (ch in input) { // UTF-16 code units, like charCodeAt
        h1 = imul(h1 xor ch.code.toLong(), 2654435761L)
        h2 = imul(h2 xor ch.code.toLong(), 1597334677L)
    }
    h1 = imul(h1 xor (h1 ushr 16), 2246822507L)
    h1 = (h1 xor imul(h2 xor (h2 ushr 13), 3266489909L)) and MASK
    h2 = imul(h2 xor (h2 ushr 16), 2246822507L)
    h2 = (h2 xor imul(h1 xor (h1 ushr 13), 3266489909L)) and MASK
    return 4294967296L * (2097151L and h2) + h1
}

/** 28 hex characters (two independent 53-bit hashes). */
fun hashComponent(value: String): String =
    java.lang.Long.toHexString(cyrb53(value, 0x9e3779b9L)).padStart(14, '0') +
        java.lang.Long.toHexString(cyrb53(value, 0x85ebca6bL)).padStart(14, '0')
