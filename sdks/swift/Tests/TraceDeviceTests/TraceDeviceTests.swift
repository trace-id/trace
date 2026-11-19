import XCTest
@testable import TraceDevice

// Tests: `swift test` from sdks/swift (macOS or Linux with Foundation). The payload and hash checks compare against
// sdks/test-vectors/native-payload.json, produced by the TypeScript SDK, so the server's tamper check passes for an
// untouched iOS app.

private func loadVectors() throws -> [String: Any] {
    // .../sdks/swift/Tests/TraceDeviceTests/TraceDeviceTests.swift -> .../sdks/test-vectors/native-payload.json
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<4 { url.deleteLastPathComponent() }
    url.appendPathComponent("test-vectors/native-payload.json")
    let data = try Data(contentsOf: url)
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
}

/// Round-trips through JSON so Swift's Int64 and Double compare the way JSON does (3 equals 3.0).
private func roundTrip(_ object: Any) throws -> NSDictionary {
    let data = try JSONSerialization.data(withJSONObject: object)
    return try JSONSerialization.jsonObject(with: data) as! NSDictionary
}

final class HashAndPayloadTests: XCTestCase {
    func testHashesMatchTypeScript() throws {
        let vectors = try loadVectors()
        for h in vectors["hashes"] as! [[String: Any]] {
            XCTAssertEqual(hashComponent(h["input"] as! String), h["hash"] as? String, "hash of \(h["input"] as! String)")
        }
    }

    func testPayloadsMatchTypeScript() throws {
        let vectors = try loadVectors()
        for (i, c) in (vectors["cases"] as! [[String: Any]]).enumerated() {
            let readings = NativeReadings(json: c["readings"] as! [String: Any])
            let built = try roundTrip(buildPayload(readings, collectMs: (c["collectMs"] as! NSNumber).int64Value))
            let expected = try roundTrip(c["payload"]!)
            XCTAssertEqual(built, expected, "payload case \(i) matches the TypeScript SDK")
        }
    }
}

/// Serves canned responses to URLSession so the client can be tested without a network.
final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, [String: String], Data))?
    static var requests: [(url: URL, body: [String: Any], headers: [String: String])] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        var bodyData = request.httpBody
        if bodyData == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            stream.close()
            bodyData = data
        }
        let body = (bodyData.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
        StubProtocol.requests.append((request.url!, body, request.allHTTPHeaderFields ?? [:]))
        let (status, headers, data) = StubProtocol.handler?(request) ?? (500, [:], Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

private final class MemoryStore: TokenStore {
    var token: String?
    func get() -> String? { token }
    func set(_ token: String) { self.token = token }
    func clear() { token = nil }
}

final class ClientTests: XCTestCase {
    private func makeClient(store: TokenStore?) throws -> TraceClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let vectors = try loadVectors()
        let readings = NativeReadings(json: (vectors["cases"] as! [[String: Any]])[0]["readings"] as! [String: Any])
        return TraceClient(
            options: TraceOptions(apiKey: "pk_test", endpoint: "https://id.example.test/"),
            readDevice: { readings },
            store: store,
            session: URLSession(configuration: config)
        )
    }

    private func ok() -> (Int, [String: String], Data) {
        (200, [:], Data(#"{"eventId":"e1","visitorId":"v1","deviceId":"v1","confidence":0.99,"suspectScore":0,"token":"tok-1"}"#.utf8))
    }

    func testIdentifiesAndStoresTheToken() async throws {
        StubProtocol.requests = []
        StubProtocol.handler = { _ in self.ok() }
        let store = MemoryStore()
        let client = try makeClient(store: store)
        let result = try await client.get(linkedId: "user-1", tags: ["action": "signup"])
        XCTAssertEqual(result.eventId, "e1")
        XCTAssertEqual(result.visitorId, "v1")
        XCTAssertNil(result.raw["token"])
        XCTAssertEqual(store.token, "tok-1")

        let first = StubProtocol.requests[0]
        XCTAssertEqual(first.url.path, "/v1/identify")
        XCTAssertEqual(first.url.query, "apiKey=pk_test")
        XCTAssertEqual(first.headers["X-Trace-App"], "com.example.shop")
        XCTAssertEqual(first.body["linkedId"] as? String, "user-1")
        XCTAssertEqual((first.body["nonce"] as? String)?.count, 32)
        XCTAssertNil(first.body["token"])

        _ = try await client.get()
        XCTAssertEqual(StubProtocol.requests[1].body["token"] as? String, "tok-1")
    }

    func testErrorCodes() async throws {
        let client = try makeClient(store: nil)
        func code(_ status: Int, _ body: String, headers: [String: String] = [:]) async -> (String, Int?) {
            StubProtocol.handler = { _ in (status, headers, Data(body.utf8)) }
            do { _ = try await client.get(); return ("ok", nil) } catch let e as IdentifyError { return (e.code, e.retryAfterSec) } catch { return ("other", nil) }
        }
        let denied = await code(403, #"{"error":{"code":"origin_not_allowed","message":"no"}}"#)
        XCTAssertEqual(denied.0, "origin_not_allowed")
        let limited = await code(429, #"{"error":{"code":"rate_limited","message":"slow"}}"#, headers: ["Retry-After": "7"])
        XCTAssertEqual(limited.0, "rate_limited")
        XCTAssertEqual(limited.1, 7)
        let bad = await code(200, #"{"unexpected":true}"#)
        XCTAssertEqual(bad.0, "invalid_response")
        let server = await code(500, "{}")
        XCTAssertEqual(server.0, "server_error")
    }

    func testConsent() async throws {
        StubProtocol.handler = { _ in self.ok() }
        let store = MemoryStore()
        let client = try makeClient(store: store)
        _ = try await client.get()
        client.disable()
        do { _ = try await client.get(); XCTFail("should be disabled") } catch let e as IdentifyError { XCTAssertEqual(e.code, "collection_disabled") }
        client.disable(forget: true)
        XCTAssertNil(store.token)
        client.enable()
        _ = try await client.get()
    }
}
