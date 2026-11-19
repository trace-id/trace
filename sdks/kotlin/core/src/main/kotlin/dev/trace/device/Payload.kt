package dev.trace.device

/** Everything the SDK reads on the device. Any value can be null when the platform cannot say. */
data class NativeReadings(
    /** "ios" or "android". */
    val platform: String,
    val osVersion: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    /** Physical screen in density-independent points. */
    val screenWidth: Double? = null,
    val screenHeight: Double? = null,
    val screenScale: Double? = null,
    val totalMemoryBytes: Long? = null,
    val timezone: String? = null,
    val languages: List<String> = emptyList(),
    val appId: String? = null,
    val appVersion: String? = null,
    val buildVersion: String? = null,
    val isDevice: Boolean? = null,
    val rooted: Boolean? = null,
    val installedAtMs: Long? = null,
    /** SHA-256 hex of the platform install id (ANDROID_ID or IDFV) salted with the app id; null when unavailable. */
    val installIdHash: String? = null,
) {
    companion object {
        /** Reads one case of test-vectors/native-payload.json (the readings the TypeScript SDK was given). */
        @Suppress("UNCHECKED_CAST")
        fun fromJson(j: Map<String, Any?>): NativeReadings {
            val screen = j["screen"] as Map<String, Any?>?
            return NativeReadings(
                platform = j["platform"] as String,
                osVersion = j["osVersion"] as String?,
                manufacturer = j["manufacturer"] as String?,
                model = j["model"] as String?,
                screenWidth = (screen?.get("width") as Number?)?.toDouble(),
                screenHeight = (screen?.get("height") as Number?)?.toDouble(),
                screenScale = (screen?.get("scale") as Number?)?.toDouble(),
                totalMemoryBytes = (j["totalMemoryBytes"] as Number?)?.toLong(),
                timezone = j["timezone"] as String?,
                languages = (j["languages"] as List<Any?>).map { it as String },
                appId = j["appId"] as String?,
                appVersion = j["appVersion"] as String?,
                buildVersion = j["buildVersion"] as String?,
                isDevice = j["isDevice"] as Boolean?,
                rooted = j["rooted"] as Boolean?,
                installedAtMs = (j["installedAt"] as Number?)?.toLong(),
                installIdHash = j["installIdHash"] as String?,
            )
        }
    }
}

private fun orEmpty(v: Any?): String = when (v) {
    null -> ""
    is Double -> Json.number(v)
    else -> v.toString()
}

/** A number that is whole is reported as an integer, like JavaScript's JSON.stringify does. */
private fun tidy(d: Double?): Any? = if (d == null) null else if (d == Math.floor(d) && Math.abs(d) < 1e15) d.toLong() else d

/**
 * Builds the identify payload (the `signals` field). Components that the browser SDK derives from attributes are derived
 * the same way, so the server's integrity check passes for an untouched app.
 */
fun buildPayload(r: NativeReadings, collectMs: Long = 0): Map<String, Any?> {
    val memoryGb = r.totalMemoryBytes?.takeIf { it > 0 }?.let { Math.round(it / 1073741824.0 * 4) / 4.0 }
    val width = r.screenWidth?.let { Math.round(it) }
    val height = r.screenHeight?.let { Math.round(it) }
    val languages = r.languages.take(10)
    val platformName = if (r.platform == "ios") "iOS" else "Android"

    val attributes = linkedMapOf<String, Any?>(
        "screenWidth" to width,
        "screenHeight" to height,
        "availWidth" to null,
        "availHeight" to null,
        "colorDepth" to null,
        "pixelRatio" to tidy(r.screenScale),
        "hardwareConcurrency" to null,
        "deviceMemory" to tidy(memoryGb),
        "maxTouchPoints" to 5,
        "timezone" to r.timezone,
        "languages" to languages,
        "platform" to platformName,
        "userAgent" to null,
        "uaBrands" to emptyList<String>(),
        "uaMobile" to true,
        "uaPlatform" to null,
        "webglVendor" to null,
        "webglRenderer" to null,
    )

    // The same inputs packages/signals/src/integrity.ts derives, with touch = true.
    val components = linkedMapOf<String, String>()
    if (width != null && height != null) {
        components["screen"] = hashComponent("${maxOf(width, height)}x${minOf(width, height)}|${orEmpty(attributes["colorDepth"])}|${orEmpty(attributes["pixelRatio"])}")
    }
    if (!r.timezone.isNullOrEmpty()) components["timezone"] = hashComponent(r.timezone)
    if (languages.isNotEmpty()) components["languages"] = hashComponent(languages.joinToString(","))
    components["platform"] = hashComponent("[${Json.stringify(platformName)},null]")
    components["hardware"] = hashComponent("|${orEmpty(attributes["deviceMemory"])}|5|true")
    components["userAgentFamily"] = hashComponent("app|${r.platform}|${r.osVersion?.split('.')?.first() ?: ""}")
    if (!r.installIdHash.isNullOrEmpty()) components["appInstall"] = r.installIdHash.take(28)

    return linkedMapOf(
        "v" to 1,
        "components" to components,
        "attributes" to attributes,
        "bot" to linkedMapOf<String, Any?>(
            "webdriver" to false,
            "headlessUserAgent" to false,
            "automationGlobals" to emptyList<String>(),
            "noPlugins" to false,
            "noLanguages" to false,
            "permissionsInconsistent" to false,
            "chromeObjectMissing" to false,
            "zeroOuterSize" to false,
        ),
        "tamper" to linkedMapOf<String, Any?>(
            "nativeOverrides" to emptyList<String>(),
            "navigatorOwnProperties" to emptyList<String>(),
            "uaPlatformMismatch" to false,
            "uaFeatureMismatch" to false,
            "canvasNoise" to false,
        ),
        "privacy" to linkedMapOf<String, Any?>("incognitoLikely" to false, "incognitoMethod" to null, "storageQuotaMb" to null),
        "storage" to linkedMapOf<String, Any?>("cookie" to false, "localStorage" to false, "indexedDb" to false),
        "app" to linkedMapOf<String, Any?>(
            "platform" to r.platform,
            "osVersion" to r.osVersion,
            "manufacturer" to r.manufacturer,
            "model" to r.model,
            "appId" to r.appId,
            "appVersion" to r.appVersion,
            "buildVersion" to r.buildVersion,
            "isDevice" to r.isDevice,
            "rooted" to r.rooted,
            "installedAt" to r.installedAtMs,
        ),
        "collectMs" to collectMs,
    )
}
