package dev.trace.device

// Dependency-free tests. Run from sdks/kotlin: the working directory decides where the vectors are found.
// The payload and hash checks compare against test-vectors/native-payload.json, produced by the TypeScript SDK, so the
// server's tamper check passes for an untouched Android app.

import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import kotlin.system.exitProcess

private var passed = 0
private var failures = 0

private fun check(ok: Boolean, name: String) {
    if (ok) passed++ else {
        failures++
        System.err.println("FAIL: $name")
    }
}

/** Structural equality where 3 and 3.0 are the same number (JSON from different languages). */
private fun same(a: Any?, b: Any?): Boolean = when {
    a is Map<*, *> && b is Map<*, *> -> a.size == b.size && a.all { (k, v) -> b.containsKey(k) && same(v, b[k]) }
    a is List<*> && b is List<*> -> a.size == b.size && a.indices.all { same(a[it], b[it]) }
    a is Number && b is Number -> a.toDouble() == b.toDouble()
    else -> a == b
}

private class MemoryStore : TokenStore {
    var token: String? = null
    override fun get() = token
    override fun set(token: String) { this.token = token }
    override fun clear() { token = null }
}

private fun codeOf(block: () -> Unit): String = try {
    block()
    "ok"
} catch (e: IdentifyException) {
    e.code
}

fun main() {
    val file = listOf("../test-vectors/native-payload.json", "sdks/test-vectors/native-payload.json").map(::File).first { it.exists() }

    @Suppress("UNCHECKED_CAST")
    val vectors = Json.parse(file.readText()) as Map<String, Any?>

    // Hashes
    @Suppress("UNCHECKED_CAST")
    for (h in vectors["hashes"] as List<Map<String, Any?>>) {
        val input = h["input"] as String
        check(hashComponent(input) == h["hash"], "hash of \"${input.take(20)}\"")
    }

    // Payloads
    @Suppress("UNCHECKED_CAST")
    val cases = vectors["cases"] as List<Map<String, Any?>>
    for ((i, c) in cases.withIndex()) {
        @Suppress("UNCHECKED_CAST")
        val readings = NativeReadings.fromJson(c["readings"] as Map<String, Any?>)
        val built = Json.parse(Json.stringify(buildPayload(readings, (c["collectMs"] as Number).toLong())))
        val ok = same(built, c["payload"])
        check(ok, "payload case $i matches the TypeScript SDK")
        if (!ok) {
            System.err.println("  built:    ${Json.stringify(built)}")
            System.err.println("  expected: ${Json.stringify(c["payload"])}")
        }
    }

    // JSON round trip
    val sample = mapOf("a" to listOf(1, 2.5, "x\"y\n", null, true), "b" to mapOf("c" to 3.0))
    check(same(Json.parse(Json.stringify(sample)), mapOf("a" to listOf(1, 2.5, "x\"y\n", null, true), "b" to mapOf("c" to 3))), "json round trip")

    // Client against a local server
    val requests = mutableListOf<Map<String, Any?>>()
    var mode = "ok"
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/") { ex ->
        val body = ex.requestBody.readBytes().toString(Charsets.UTF_8)
        requests.add(
            mapOf(
                "path" to ex.requestURI.path,
                "query" to ex.requestURI.rawQuery,
                "contentType" to ex.requestHeaders.getFirst("Content-Type"),
                "app" to ex.requestHeaders.getFirst("X-Trace-App"),
                "body" to Json.parse(body),
            ),
        )
        if (mode == "slow") Thread.sleep(700)
        val (status, text) = when (mode) {
            "denied" -> 403 to """{"error":{"code":"origin_not_allowed","message":"no"}}"""
            "limited" -> { ex.responseHeaders.add("Retry-After", "7"); 429 to """{"error":{"code":"rate_limited","message":"slow down"}}""" }
            "bad" -> 200 to """{"unexpected":true}"""
            else -> 200 to """{"eventId":"e1","visitorId":"v1","deviceId":"v1","confidence":0.99,"suspectScore":0,"token":"tok-1"}"""
        }
        val bytes = text.toByteArray()
        ex.responseHeaders.add("Content-Type", "application/json")
        try {
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        } catch (_: java.io.IOException) {
            // The client gave up (timeout test).
        }
    }
    server.executor = java.util.concurrent.Executors.newCachedThreadPool()
    server.start()
    val endpoint = "http://127.0.0.1:${server.address.port}"

    @Suppress("UNCHECKED_CAST")
    val readings = NativeReadings.fromJson((cases[0]["readings"]) as Map<String, Any?>)
    val store = MemoryStore()
    val client = TraceClient(TraceOptions("pk_test", endpoint, timeoutMs = 300), { readings }, store)

    val result = client.get(linkedId = "user-1", tags = mapOf("action" to "signup"))
    check(result.eventId == "e1" && result.visitorId == "v1" && !result.raw.containsKey("token"), "result has no token")
    check(store.token == "tok-1", "token is stored")
    val first = requests.last()
    check(first["path"] == "/v1/identify" && first["query"] == "apiKey=pk_test" && first["contentType"] == "text/plain", "request line and content type")
    check(first["app"] == "com.example.shop", "X-Trace-App header")
    @Suppress("UNCHECKED_CAST")
    val body = first["body"] as Map<String, Any?>
    check(body["linkedId"] == "user-1" && (body["tags"] as Map<*, *>)["action"] == "signup", "linkedId and tags are sent")
    check((body["nonce"] as String).length == 32 && body["token"] == null && body["sentAt"] is Number, "nonce, sentAt, no token on first call")
    check((body["sdk"] as Map<*, *>)["name"] == "dev.trace.device", "sdk name")

    client.get()
    @Suppress("UNCHECKED_CAST")
    check((requests.last()["body"] as Map<String, Any?>)["token"] == "tok-1", "stored token is sent on the next call")

    mode = "denied"
    check(codeOf { client.get() } == "origin_not_allowed", "403 origin_not_allowed")
    mode = "limited"
    try {
        client.get()
        check(false, "429 should throw")
    } catch (e: IdentifyException) {
        check(e.code == "rate_limited" && e.retryAfterSec == 7, "429 rate_limited with Retry-After")
    }
    mode = "bad"
    check(codeOf { client.get() } == "invalid_response", "unexpected body")
    mode = "slow"
    check(codeOf { client.get() } == "timeout", "timeout")
    mode = "ok"

    client.disable()
    check(codeOf { client.get() } == "collection_disabled", "disabled")
    client.disable(forget = true)
    check(store.token == null, "disable(forget) clears the token")
    client.enable()
    check(codeOf { client.get() } == "ok", "enable resumes")

    check(runCatching { TraceClient(TraceOptions("sk_secret", "http://x"), { readings }) }.exceptionOrNull() is IllegalArgumentException, "a secret key is refused")

    var asyncResult: Result<IdentifyResult>? = null
    val latch = java.util.concurrent.CountDownLatch(1)
    client.getAsync { asyncResult = it; latch.countDown() }
    latch.await(5, java.util.concurrent.TimeUnit.SECONDS)
    check(asyncResult?.getOrNull()?.visitorId == "v1", "getAsync delivers the result")

    server.stop(0)
    println("$passed passed, $failures failed")
    exitProcess(if (failures == 0) 0 else 1)
}
