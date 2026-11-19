package dev.trace.device

import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.security.SecureRandom

/** code: collection_disabled, timeout, network, invalid_api_key, origin_not_allowed, rate_limited, bad_request,
 * server_error, invalid_response. */
class IdentifyException(
    val code: String,
    message: String,
    val status: Int? = null,
    val retryAfterSec: Int? = null,
) : Exception(message)

/** Where the SDK keeps the visitor token: the Android Keystore in an app (see the android module). Blocking calls. */
interface TokenStore {
    fun get(): String?
    fun set(token: String)
    fun clear()
}

/** Options for [TraceClient]. */
data class TraceOptions(
    /** Public key (pk_...). Add `app:<your application id>` to its allowed origins. */
    val apiKey: String,
    /** Your Trace server, for example https://id.example.com. */
    val endpoint: String,
    /** Keep the visitor token in secure storage so the visitor is recognised across launches. Default true. */
    val persistToken: Boolean = true,
    /** Request timeout in milliseconds. Default 10 s (mobile networks are slower than a desktop browser). */
    val timeoutMs: Int = 10_000,
)

/** The identify result, without the token. [raw] holds every field the server returned. */
class IdentifyResult(val raw: Map<String, Any?>) {
    val eventId: String get() = raw["eventId"] as String
    val visitorId: String get() = raw["visitorId"] as String
    val deviceId: String? get() = raw["deviceId"] as String?
    val confidence: Double get() = (raw["confidence"] as Number).toDouble()
    val suspectScore: Double get() = ((raw["suspectScore"] ?: 0) as Number).toDouble()
}

/**
 * Collects device readings and identifies the device with your Trace server. Send [IdentifyResult.eventId] to your
 * backend and verify it there with the secret key: anything an app reports can be forged on a rooted device.
 *
 * [get] blocks; call it from a background thread or a coroutine on Dispatchers.IO, or use [getAsync].
 */
class TraceClient(
    private val options: TraceOptions,
    private val readDevice: () -> NativeReadings,
    private val store: TokenStore? = null,
    private val random: SecureRandom = SecureRandom(),
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    @Volatile
    private var enabled = true

    init {
        require(!options.apiKey.startsWith("sk_")) { "Use a public key (pk_...) in the app; secret keys belong on your server" }
    }

    /** Consent: stop collecting until [enable]; with [forget], also delete the stored token. */
    fun disable(forget: Boolean = false) {
        enabled = false
        if (forget) store?.clear()
    }

    fun enable() {
        enabled = true
    }

    /** Runs [get] on a new thread and delivers the outcome to [callback] (on that thread). */
    fun getAsync(linkedId: String? = null, tags: Map<String, Any?>? = null, callback: (Result<IdentifyResult>) -> Unit) {
        Thread { callback(runCatching { get(linkedId, tags) }) }.start()
    }

    /**
     * Identifies this device. [linkedId] is your user or account id (never an email or a name); [tags] are up to 10
     * short values returned with the event.
     */
    @Throws(IdentifyException::class)
    fun get(linkedId: String? = null, tags: Map<String, Any?>? = null): IdentifyResult {
        if (!enabled) throw IdentifyException("collection_disabled", "Collection is disabled")
        val started = now()
        val persist = options.persistToken && store != null
        val readings = readDevice()
        val token = if (persist) runCatching { store!!.get() }.getOrNull() else null

        val body = linkedMapOf<String, Any?>(
            "signals" to buildPayload(readings, now() - started),
            "sdk" to mapOf("name" to "dev.trace.device", "version" to VERSION),
        )
        if (token != null) body["token"] = token
        if (linkedId != null) body["linkedId"] = linkedId
        if (tags != null) body["tags"] = tags
        body["sentAt"] = now()
        body["nonce"] = ByteArray(16).also { random.nextBytes(it) }.joinToString("") { "%02x".format(it) }

        val url = URL("${options.endpoint.trimEnd('/')}/v1/identify?apiKey=${URLEncoder.encode(options.apiKey, "UTF-8")}")
        val conn = url.openConnection() as HttpURLConnection
        val status: Int
        val text: String
        val retryAfter: Int?
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = options.timeoutMs
            conn.readTimeout = options.timeoutMs
            conn.instanceFollowRedirects = false
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "text/plain")
            // No Origin from a native app: the server checks this id against the key's app:<id> entries.
            if (readings.appId != null) conn.setRequestProperty("X-Trace-App", readings.appId)
            conn.outputStream.use { it.write(Json.stringify(body).toByteArray(Charsets.UTF_8)) }
            status = conn.responseCode
            retryAfter = conn.getHeaderField("Retry-After")?.toIntOrNull()
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        } catch (e: SocketTimeoutException) {
            throw IdentifyException("timeout", "Request timed out")
        } catch (e: IOException) {
            throw IdentifyException("network", e.message ?: "Network error")
        } finally {
            conn.disconnect()
        }

        val json = runCatching { Json.parse(text) }.getOrNull()
        if (status !in 200..299) {
            val error = (json as? Map<*, *>)?.get("error") as? Map<*, *>
            val serverCode = error?.get("code") as? String
            val serverMessage = error?.get("message") as? String
            throw IdentifyException(codeFor(status, serverCode), serverMessage ?: "HTTP $status", status, retryAfter?.takeIf { it > 0 })
        }
        @Suppress("UNCHECKED_CAST")
        val map = json as? Map<String, Any?>
        if (map == null || map["eventId"] !is String || map["visitorId"] !is String || map["token"] !is String || map["confidence"] !is Number) {
            throw IdentifyException("invalid_response", "Unexpected response shape", status)
        }
        if (persist) runCatching { store!!.set(map["token"] as String) }
        return IdentifyResult(map.filterKeys { it != "token" })
    }

    private fun codeFor(status: Int, serverCode: String?): String = when {
        status == 401 -> "invalid_api_key"
        status == 403 -> if (serverCode == "origin_not_allowed") "origin_not_allowed" else "invalid_api_key"
        status == 429 -> "rate_limited"
        status in 400..499 -> "bad_request"
        else -> "server_error"
    }

    companion object {
        const val VERSION = "0.1.0"
    }
}
