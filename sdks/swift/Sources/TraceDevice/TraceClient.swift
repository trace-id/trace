import Foundation

/// code: collection_disabled, timeout, network, invalid_api_key, origin_not_allowed, rate_limited, bad_request,
/// server_error, invalid_response.
public struct IdentifyError: Error, CustomStringConvertible {
    public let code: String
    public let message: String
    public let status: Int?
    public let retryAfterSec: Int?

    public init(_ code: String, _ message: String, status: Int? = nil, retryAfterSec: Int? = nil) {
        self.code = code; self.message = message; self.status = status; self.retryAfterSec = retryAfterSec
    }

    public var description: String { "IdentifyError(\(code)): \(message)" }
}

/// Where the SDK keeps the visitor token: the Keychain in an app (see Device.swift).
public protocol TokenStore {
    func get() -> String?
    func set(_ token: String)
    func clear()
}

public struct TraceOptions {
    /// Public key (pk_...). Add `app:<your bundle identifier>` to its allowed origins.
    public var apiKey: String
    /// Your Trace server, for example https://id.example.com.
    public var endpoint: String
    /// Keep the visitor token in secure storage so the visitor is recognised across launches. Default true.
    public var persistToken: Bool
    /// Request timeout in seconds. Default 10 (mobile networks are slower than a desktop browser).
    public var timeout: TimeInterval

    public init(apiKey: String, endpoint: String, persistToken: Bool = true, timeout: TimeInterval = 10) {
        self.apiKey = apiKey; self.endpoint = endpoint; self.persistToken = persistToken; self.timeout = timeout
    }
}

/// The identify result, without the token. `raw` holds every field the server returned.
public struct IdentifyResult {
    public let raw: [String: Any]

    public var eventId: String { raw["eventId"] as? String ?? "" }
    public var visitorId: String { raw["visitorId"] as? String ?? "" }
    public var deviceId: String? { raw["deviceId"] as? String }
    public var confidence: Double { (raw["confidence"] as? NSNumber)?.doubleValue ?? 0 }
    public var suspectScore: Double { (raw["suspectScore"] as? NSNumber)?.doubleValue ?? 0 }
}

/// Refuses redirects: a redirect would resend the request somewhere the key was never meant to go.
private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Collects device readings and identifies the device with your Trace server. Send `eventId` to your backend and verify it
/// there with the secret key: anything an app reports can be forged on a jailbroken device.
public final class TraceClient {
    public static let version = "0.1.0"

    private let options: TraceOptions
    private let readDevice: () async throws -> NativeReadings
    private let store: TokenStore?
    private let session: URLSession
    private let redirectGuard = NoRedirect()
    private let lock = NSLock()
    private var enabled = true

    /// - Parameter session: pass your own for tests (for example with a URLProtocol stub).
    public init(options: TraceOptions, readDevice: @escaping () async throws -> NativeReadings, store: TokenStore? = nil, session: URLSession? = nil) {
        precondition(!options.apiKey.hasPrefix("sk_"), "Use a public key (pk_...) in the app; secret keys belong on your server")
        self.options = options
        self.readDevice = readDevice
        self.store = store
        self.session = session ?? URLSession(configuration: .ephemeral)
    }

    /// Consent: stop collecting until `enable()`; with `forget`, also delete the stored token.
    public func disable(forget: Bool = false) {
        lock.lock(); enabled = false; lock.unlock()
        if forget { store?.clear() }
    }

    public func enable() {
        lock.lock(); enabled = true; lock.unlock()
    }

    private var isEnabled: Bool {
        lock.lock(); defer { lock.unlock() }
        return enabled
    }

    /// Identifies this device. `linkedId` is your user or account id (never an email or a name); `tags` are up to 10 short
    /// values returned with the event.
    public func get(linkedId: String? = nil, tags: [String: Any]? = nil) async throws -> IdentifyResult {
        guard isEnabled else { throw IdentifyError("collection_disabled", "Collection is disabled") }
        let started = Date()
        let persist = options.persistToken && store != nil
        let readings = try await readDevice()
        let token = persist ? store?.get() : nil

        var body: [String: Any] = [
            "signals": buildPayload(readings, collectMs: Int64(Date().timeIntervalSince(started) * 1000)),
            "sdk": ["name": "TraceDevice", "version": TraceClient.version],
            "sentAt": Int64(Date().timeIntervalSince1970 * 1000),
            "nonce": (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined(),
        ]
        if let token = token { body["token"] = token }
        if let linkedId = linkedId { body["linkedId"] = linkedId }
        if let tags = tags { body["tags"] = tags }

        var components = URLComponents(string: options.endpoint.trimmingTrailingSlashes() + "/v1/identify")
        components?.queryItems = [URLQueryItem(name: "apiKey", value: options.apiKey)]
        guard let url = components?.url else { throw IdentifyError("network", "Invalid endpoint") }
        var request = URLRequest(url: url, timeoutInterval: options.timeout)
        request.httpMethod = "POST"
        request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        // No Origin from a native app: the server checks this id against the key's app:<id> entries.
        if let appId = readings.appId { request.setValue(appId, forHTTPHeaderField: "X-Trace-App") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request, delegate: redirectGuard)
        } catch let error as URLError where error.code == .timedOut {
            throw IdentifyError("timeout", "Request timed out")
        } catch {
            throw IdentifyError("network", error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw IdentifyError("invalid_response", "Not an HTTP response") }

        let json = try? JSONSerialization.jsonObject(with: data)
        if !(200...299).contains(http.statusCode) {
            let error = (json as? [String: Any])?["error"] as? [String: Any]
            let retry = Int(http.value(forHTTPHeaderField: "Retry-After") ?? "")
            throw IdentifyError(
                TraceClient.code(for: http.statusCode, serverCode: error?["code"] as? String),
                error?["message"] as? String ?? "HTTP \(http.statusCode)",
                status: http.statusCode,
                retryAfterSec: (retry ?? 0) > 0 ? retry : nil
            )
        }
        guard var map = json as? [String: Any], map["eventId"] is String, map["visitorId"] is String,
              let newToken = map["token"] as? String, map["confidence"] is NSNumber else {
            throw IdentifyError("invalid_response", "Unexpected response shape", status: http.statusCode)
        }
        if persist { store?.set(newToken) }
        map.removeValue(forKey: "token")
        return IdentifyResult(raw: map)
    }

    private static func code(for status: Int, serverCode: String?) -> String {
        switch status {
        case 401: return "invalid_api_key"
        case 403: return serverCode == "origin_not_allowed" ? "origin_not_allowed" : "invalid_api_key"
        case 429: return "rate_limited"
        case 400..<500: return "bad_request"
        default: return "server_error"
        }
    }
}

private extension String {
    func trimmingTrailingSlashes() -> String {
        var s = self
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }
}
