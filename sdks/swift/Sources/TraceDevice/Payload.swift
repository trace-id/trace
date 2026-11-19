import Foundation

/// Everything the SDK reads on the device. Any value can be nil when the platform cannot say.
public struct NativeReadings {
    /// "ios" or "android".
    public var platform: String
    public var osVersion: String?
    public var manufacturer: String?
    public var model: String?
    /// Screen in points.
    public var screenWidth: Double?
    public var screenHeight: Double?
    public var screenScale: Double?
    public var totalMemoryBytes: Int64?
    public var timezone: String?
    public var languages: [String]
    public var appId: String?
    public var appVersion: String?
    public var buildVersion: String?
    public var isDevice: Bool?
    public var rooted: Bool?
    public var installedAtMs: Int64?
    /// SHA-256 hex of the platform install id (IDFV) salted with the app id; nil when unavailable.
    public var installIdHash: String?

    public init(
        platform: String = "ios", osVersion: String? = nil, manufacturer: String? = nil, model: String? = nil,
        screenWidth: Double? = nil, screenHeight: Double? = nil, screenScale: Double? = nil, totalMemoryBytes: Int64? = nil,
        timezone: String? = nil, languages: [String] = [], appId: String? = nil, appVersion: String? = nil, buildVersion: String? = nil,
        isDevice: Bool? = nil, rooted: Bool? = nil, installedAtMs: Int64? = nil, installIdHash: String? = nil
    ) {
        self.platform = platform; self.osVersion = osVersion; self.manufacturer = manufacturer; self.model = model
        self.screenWidth = screenWidth; self.screenHeight = screenHeight; self.screenScale = screenScale
        self.totalMemoryBytes = totalMemoryBytes; self.timezone = timezone; self.languages = languages
        self.appId = appId; self.appVersion = appVersion; self.buildVersion = buildVersion
        self.isDevice = isDevice; self.rooted = rooted; self.installedAtMs = installedAtMs; self.installIdHash = installIdHash
    }

    /// Reads one case of test-vectors/native-payload.json (the readings the TypeScript SDK was given).
    public init(json j: [String: Any]) {
        let screen = j["screen"] as? [String: Any]
        self.init(
            platform: j["platform"] as? String ?? "ios",
            osVersion: j["osVersion"] as? String,
            manufacturer: j["manufacturer"] as? String,
            model: j["model"] as? String,
            screenWidth: (screen?["width"] as? NSNumber)?.doubleValue,
            screenHeight: (screen?["height"] as? NSNumber)?.doubleValue,
            screenScale: (screen?["scale"] as? NSNumber)?.doubleValue,
            totalMemoryBytes: (j["totalMemoryBytes"] as? NSNumber)?.int64Value,
            timezone: j["timezone"] as? String,
            languages: j["languages"] as? [String] ?? [],
            appId: j["appId"] as? String,
            appVersion: j["appVersion"] as? String,
            buildVersion: j["buildVersion"] as? String,
            isDevice: j["isDevice"] as? Bool,
            rooted: j["rooted"] as? Bool,
            installedAtMs: (j["installedAt"] as? NSNumber)?.int64Value,
            installIdHash: j["installIdHash"] as? String
        )
    }
}

private let null = NSNull()

private func orNull(_ v: Any?) -> Any { v ?? null }

/// A number the way JavaScript prints it: whole values without a trailing ".0".
private func jsNumber(_ d: Double) -> String {
    d == d.rounded(.towardZero) && abs(d) < 1e15 ? String(Int64(d)) : String(d)
}

/// A whole number is reported as an integer, like JavaScript's JSON.stringify does.
private func tidy(_ d: Double?) -> Any {
    guard let d = d else { return null }
    return d == d.rounded(.towardZero) && abs(d) < 1e15 ? Int64(d) as Any : d as Any
}

/// JavaScript's Math.round: halves round up.
private func jsRound(_ d: Double) -> Int64 { Int64((d + 0.5).rounded(.down)) }

/// Builds the identify payload (the `signals` field). Components that the browser SDK derives from attributes are derived
/// the same way, so the server's integrity check passes for an untouched app.
public func buildPayload(_ r: NativeReadings, collectMs: Int64 = 0) -> [String: Any] {
    var memoryGb: Double?
    if let bytes = r.totalMemoryBytes, bytes > 0 { memoryGb = Double(jsRound(Double(bytes) / 1073741824.0 * 4)) / 4.0 }
    let width = r.screenWidth.map(jsRound)
    let height = r.screenHeight.map(jsRound)
    let languages = Array(r.languages.prefix(10))
    let platformName = r.platform == "ios" ? "iOS" : "Android"

    let attributes: [String: Any] = [
        "screenWidth": orNull(width), "screenHeight": orNull(height), "availWidth": null, "availHeight": null,
        "colorDepth": null, "pixelRatio": tidy(r.screenScale), "hardwareConcurrency": null, "deviceMemory": tidy(memoryGb),
        "maxTouchPoints": 5, "timezone": orNull(r.timezone), "languages": languages, "platform": platformName,
        "userAgent": null, "uaBrands": [String](), "uaMobile": true, "uaPlatform": null, "webglVendor": null, "webglRenderer": null,
    ]

    // The same inputs packages/signals/src/integrity.ts derives, with touch = true.
    var components: [String: String] = [:]
    if let w = width, let h = height {
        components["screen"] = hashComponent("\(max(w, h))x\(min(w, h))||\(r.screenScale.map(jsNumber) ?? "")")
    }
    if let tz = r.timezone, !tz.isEmpty { components["timezone"] = hashComponent(tz) }
    if !languages.isEmpty { components["languages"] = hashComponent(languages.joined(separator: ",")) }
    components["platform"] = hashComponent("[\"\(platformName)\",null]")
    components["hardware"] = hashComponent("|\(memoryGb.map(jsNumber) ?? "")|5|true")
    let osMajor = r.osVersion?.split(separator: ".", omittingEmptySubsequences: false).first.map(String.init) ?? ""
    components["userAgentFamily"] = hashComponent("app|\(r.platform)|\(osMajor)")
    if let install = r.installIdHash, !install.isEmpty { components["appInstall"] = String(install.prefix(28)) }

    return [
        "v": 1,
        "components": components,
        "attributes": attributes,
        "bot": [
            "webdriver": false, "headlessUserAgent": false, "automationGlobals": [String](), "noPlugins": false,
            "noLanguages": false, "permissionsInconsistent": false, "chromeObjectMissing": false, "zeroOuterSize": false,
        ] as [String: Any],
        "tamper": [
            "nativeOverrides": [String](), "navigatorOwnProperties": [String](), "uaPlatformMismatch": false,
            "uaFeatureMismatch": false, "canvasNoise": false,
        ] as [String: Any],
        "privacy": ["incognitoLikely": false, "incognitoMethod": null, "storageQuotaMb": null] as [String: Any],
        "storage": ["cookie": false, "localStorage": false, "indexedDb": false] as [String: Any],
        "app": [
            "platform": r.platform, "osVersion": orNull(r.osVersion), "manufacturer": orNull(r.manufacturer), "model": orNull(r.model),
            "appId": orNull(r.appId), "appVersion": orNull(r.appVersion), "buildVersion": orNull(r.buildVersion),
            "isDevice": orNull(r.isDevice), "rooted": orNull(r.rooted), "installedAt": orNull(r.installedAtMs),
        ] as [String: Any],
        "collectMs": collectMs,
    ]
}
