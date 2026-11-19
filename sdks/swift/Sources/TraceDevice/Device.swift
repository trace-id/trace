#if canImport(UIKit)
import CryptoKit
import Foundation
import Security
import UIKit

// UNVERIFIED: written without building on a Mac. The core (Hash, Payload, TraceClient) is tested against the TypeScript
// SDK's vectors in CI; try this device glue in your app first.

/// Reads the device. Nothing here asks for a permission. The raw install id never leaves the device: it is hashed with
/// the app id, so the same phone cannot be matched across different companies' apps.
public func readDevice() async -> NativeReadings {
    let device = UIDevice.current
    let screen = UIScreen.main
    let bundle = Bundle.main
    let appId = bundle.bundleIdentifier
    var installHash: String?
    if let vendor = device.identifierForVendor?.uuidString {
        let digest = SHA256.hash(data: Data("\(appId ?? "")|\(vendor)".utf8))
        installHash = digest.map { String(format: "%02x", $0) }.joined()
    }
    #if targetEnvironment(simulator)
    let isDevice = false
    #else
    let isDevice = true
    #endif
    return NativeReadings(
        platform: "ios",
        osVersion: device.systemVersion,
        manufacturer: "Apple",
        model: hardwareIdentifier(),
        screenWidth: Double(screen.bounds.width),
        screenHeight: Double(screen.bounds.height),
        screenScale: Double(screen.scale),
        totalMemoryBytes: Int64(ProcessInfo.processInfo.physicalMemory),
        timezone: TimeZone.current.identifier,
        languages: Locale.preferredLanguages,
        appId: appId,
        appVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
        buildVersion: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
        isDevice: isDevice,
        rooted: looksJailbroken(),
        installedAtMs: nil,
        installIdHash: installHash
    )
}

/// The hardware model, such as "iPhone16,1" (the marketing name needs a lookup table this SDK does not carry).
private func hardwareIdentifier() -> String {
    var info = utsname()
    uname(&info)
    return withUnsafePointer(to: &info.machine) {
        $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
    }
}

/// Heuristics only: a jailbroken device can hide all of these, which is why the server decides, not the app.
private func looksJailbroken() -> Bool {
    #if targetEnvironment(simulator)
    return false
    #else
    let paths = ["/Applications/Cydia.app", "/Library/MobileSubstrate/MobileSubstrate.dylib", "/bin/bash", "/usr/sbin/sshd", "/etc/apt", "/private/var/lib/apt/"]
    return paths.contains { FileManager.default.fileExists(atPath: $0) }
    #endif
}

/// The visitor token in the Keychain, readable after the first unlock and never restored onto another device: a new phone is
/// a new device.
public final class KeychainTokenStore: TokenStore {
    private let service = "trace_device"
    private let account = "visitor_token"

    public init() {}

    private var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func get() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func set(_ token: String) {
        clear()
        var query = base
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    public func clear() {
        SecItemDelete(base as CFDictionary)
    }
}

/// A ready-to-use client: device readings from UIKit and the token in the Keychain. Create one for the app and reuse it.
///
///     let trace = makeTraceClient(apiKey: "pk_...", endpoint: "https://id.example.com")
///     let result = try await trace.get(linkedId: userId, tags: ["action": "signup"])
///     // send result.eventId to your backend and verify it there with your secret key
public func makeTraceClient(apiKey: String, endpoint: String, persistToken: Bool = true) -> TraceClient {
    TraceClient(options: TraceOptions(apiKey: apiKey, endpoint: endpoint, persistToken: persistToken), readDevice: readDevice, store: KeychainTokenStore())
}
#endif
