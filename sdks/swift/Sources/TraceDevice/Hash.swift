// Component hashes. A port of cyrb53 from packages/signals/src/hash.ts: the server recomputes these from the plain
// attributes, so the result must be identical to the TypeScript one (see test-vectors/native-payload.json).

private func cyrb53(_ input: String, seed: UInt32) -> UInt64 {
    var h1: UInt32 = 0xdeadbeef ^ seed
    var h2: UInt32 = 0x41c6ce57 ^ seed
    for unit in input.utf16 { // UTF-16 code units, like charCodeAt
        let ch = UInt32(unit)
        h1 = (h1 ^ ch) &* 2654435761
        h2 = (h2 ^ ch) &* 1597334677
    }
    h1 = (h1 ^ (h1 >> 16)) &* 2246822507
    h1 ^= (h2 ^ (h2 >> 13)) &* 3266489909
    h2 = (h2 ^ (h2 >> 16)) &* 2246822507
    h2 ^= (h1 ^ (h1 >> 13)) &* 3266489909
    return 4294967296 * UInt64(2097151 & h2) + UInt64(h1)
}

private func hex14(_ value: UInt64) -> String {
    let s = String(value, radix: 16)
    return String(repeating: "0", count: max(0, 14 - s.count)) + s
}

/// 28 hex characters (two independent 53-bit hashes).
public func hashComponent(_ value: String) -> String {
    hex14(cyrb53(value, seed: 0x9e3779b9)) + hex14(cyrb53(value, seed: 0x85ebca6b))
}
