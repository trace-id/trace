package dev.trace.device.android

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageInfo
import android.os.Build
import android.os.LocaleList
import android.provider.Settings
import dev.trace.device.NativeReadings
import dev.trace.device.TraceClient
import dev.trace.device.TraceOptions
import java.io.File
import java.security.MessageDigest
import java.util.TimeZone

// UNVERIFIED: this module needs the Android SDK and was written without building it. The pure-JVM core (../core) is
// tested; try this glue in your app first.

/** Reads the device. Nothing here asks for a permission. */
class AndroidDeviceReader(context: Context) {
    private val app = context.applicationContext

    fun read(): NativeReadings {
        val metrics = app.resources.displayMetrics
        val density = metrics.density.takeIf { it > 0f } ?: 1f
        val packageInfo: PackageInfo? = runCatching { app.packageManager.getPackageInfo(app.packageName, 0) }.getOrNull()
        val memory = ActivityManager.MemoryInfo().also {
            (app.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(it)
        }
        val languages = LocaleList.getDefault().let { list -> (0 until list.size()).map { list[it].toLanguageTag() } }
        // The raw install id never leaves the device: it is hashed with the app id, so the same phone cannot be matched
        // across different companies' apps.
        val androidId = runCatching { Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID) }.getOrNull()

        return NativeReadings(
            platform = "android",
            osVersion = Build.VERSION.RELEASE,
            manufacturer = Build.MANUFACTURER,
            model = Build.MODEL,
            screenWidth = metrics.widthPixels / density.toDouble(),
            screenHeight = metrics.heightPixels / density.toDouble(),
            screenScale = density.toDouble(),
            totalMemoryBytes = memory.totalMem.takeIf { it > 0 },
            timezone = TimeZone.getDefault().id,
            languages = languages,
            appId = app.packageName,
            appVersion = packageInfo?.versionName,
            buildVersion = packageInfo?.let { if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toString() else @Suppress("DEPRECATION") it.versionCode.toString() },
            isDevice = !looksLikeEmulator(),
            rooted = looksRooted(),
            installedAtMs = packageInfo?.firstInstallTime,
            installIdHash = if (androidId.isNullOrEmpty()) null else sha256("${app.packageName}|$androidId"),
        )
    }

    private fun looksLikeEmulator(): Boolean =
        Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") ||
            Build.MODEL.contains("Emulator") || Build.MODEL.contains("Android SDK built for") ||
            Build.MANUFACTURER.contains("Genymotion") || Build.HARDWARE.contains("goldfish") || Build.HARDWARE.contains("ranchu") ||
            Build.PRODUCT.contains("sdk_gphone")

    /** Heuristics only: a rooted device can hide all of these, which is why the server decides, not the app. */
    private fun looksRooted(): Boolean {
        if (Build.TAGS?.contains("test-keys") == true) return true
        val paths = listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/sd/xbin/su", "/data/local/xbin/su", "/data/local/bin/su")
        return paths.any { File(it).exists() }
    }

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}

/**
 * A ready-to-use client: device readings from [AndroidDeviceReader] and the token in Keystore-backed storage.
 * Create one for the app and reuse it. [TraceClient.get] blocks, so call it from a coroutine on Dispatchers.IO or use
 * [TraceClient.getAsync].
 *
 *     val trace = createTraceClient(applicationContext, "pk_...", "https://id.example.com")
 *     trace.getAsync(linkedId = userId, tags = mapOf("action" to "signup")) { result -> /* send result.getOrNull()?.eventId */ }
 */
fun createTraceClient(context: Context, apiKey: String, endpoint: String, persistToken: Boolean = true): TraceClient {
    val reader = AndroidDeviceReader(context)
    return TraceClient(
        options = TraceOptions(apiKey = apiKey, endpoint = endpoint, persistToken = persistToken),
        readDevice = reader::read,
        store = KeystoreTokenStore(context),
    )
}
