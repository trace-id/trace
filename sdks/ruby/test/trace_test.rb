require "json"
require "minitest/autorun"
require "socket"
require "stringio"
require_relative "../lib/trace"

VECTORS = JSON.parse(File.read(File.join(__dir__, "..", "..", "test-vectors", "vectors.json")))
EVENT_ID = VECTORS["eventId"]["valid"]
EVENT = JSON.parse(VECTORS["webhook"]["body"])["data"]

# A tiny HTTP server standing in for the Trace API.
class FakeApi
  attr_reader :port

  def initialize
    @server = TCPServer.new("127.0.0.1", 0)
    @port = @server.addr[1]
    @thread = Thread.new do
      loop do
        client = @server.accept
        handle(client)
      rescue IOError, SystemCallError
        break
      end
    end
  end

  def endpoint
    "http://127.0.0.1:#{@port}"
  end

  def stop
    @server.close
    @thread.kill
  end

  private

  def handle(client)
    request_line = client.gets.to_s
    method, path = request_line.split(" ")
    headers = {}
    while (line = client.gets) && line != "\r\n"
      k, v = line.split(":", 2)
      headers[k.downcase] = v.to_s.strip
    end
    body = headers["content-length"] ? client.read(headers["content-length"].to_i) : ""
    status, payload =
      if headers["authorization"] != "Bearer sk_test"
        [401, { "error" => { "code" => "unauthorized", "message" => "bad key" } }]
      elsif method == "GET" && path.end_with?(EVENT_ID)
        [200, EVENT]
      elsif method == "PUT"
        label = path.split("/").last
        if label == "full"
          [409, { "error" => { "code" => "limit_reached", "message" => "too many types" } }]
        else
          [200, { "eventId" => path.split("/")[3], "label" => label, "fraud" => JSON.parse(body)["fraud"] }]
        end
      elsif method == "DELETE" && path.end_with?("/labels/payment")
        [204, nil]
      else
        [404, { "error" => { "code" => "not_found", "message" => "Event not found" } }]
      end
    raw = payload.nil? ? "" : JSON.generate(payload)
    client.write("HTTP/1.1 #{status} X\r\nContent-Type: application/json\r\nContent-Length: #{raw.bytesize}\r\nConnection: close\r\n\r\n#{raw}")
    client.close
  end
end

class TraceTest < Minitest::Test
  def self.api
    @api ||= FakeApi.new
  end

  Minitest.after_run { api.stop }

  def api
    self.class.api
  end

  def code_of(klass = Trace::VerifyError)
    yield
    "ok"
  rescue klass => e
    e.code
  end

  def test_webhook_valid
    w = VECTORS["webhook"]
    payload = Trace.verify_webhook(w["body"], w["signature"], w["secret"], now: w["nowAccepted"])
    assert_equal "wh_1", payload["id"]
    assert_equal 75, payload["data"]["suspectScore"]
  end

  def test_webhook_rejections
    w = VECTORS["webhook"]
    {
      [nil, w["nowAccepted"]] => "missing_signature",
      ["garbage", w["nowAccepted"]] => "malformed_signature",
      [w["signature"], w["nowTooLate"]] => "timestamp_out_of_range",
      [w["badSignature"], w["nowAccepted"]] => "invalid_signature"
    }.each do |(sig, now), code|
      assert_equal code, code_of(Trace::WebhookError) { Trace.verify_webhook(w["body"], sig, w["secret"], now: now) }
    end
  end

  def test_sealed
    s = VECTORS["sealed"]
    event = Trace.unseal_event_result(s["valid"], s["key"])
    assert_equal s["expect"]["eventId"], event["eventId"]
    assert_equal s["expect"]["suspectScore"], event["suspectScore"]
    assert_equal "tampered", code_of(Trace::SealedError) { Trace.unseal_event_result(s["tampered"], s["key"]) }
    assert_equal "expired", code_of(Trace::SealedError) { Trace.unseal_event_result(s["expired"], s["key"]) }
    assert_equal "invalid_key", code_of(Trace::SealedError) { Trace.unseal_event_result(s["valid"], "short") }
    assert_equal "ok", code_of(Trace::SealedError) { Trace.unseal_event_result(s["expired"], s["key"], check_expiry: false) }
    rotated = Trace.unseal_event_result(s["valid"], ["CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=", s["key"]])
    assert_equal s["expect"]["eventId"], rotated["eventId"]
  end

  def test_client
    c = Trace::Client.new("sk_test", api.endpoint)
    assert_equal 75, c.get_event(EVENT_ID)["suspectScore"]
    assert_equal "invalid_event_id", code_of { c.get_event("nope") }
    assert_equal "not_found", code_of { c.get_event("01a1dcf6-53b8-7c68-bd1d-000000000000") }
    assert_equal "unauthorized", code_of { Trace::Client.new("sk_wrong", api.endpoint).get_event(EVENT_ID) }
    assert_equal "unauthorized", code_of { Trace::Client.new("pk_public", api.endpoint) }
    assert_equal true, c.label_event(EVENT_ID, "payment", true)["fraud"]
    assert_equal "invalid_label", code_of { c.label_event(EVENT_ID, "Payment", true) }
    assert_equal "limit_reached", code_of { c.label_event(EVENT_ID, "full", true) }
    assert_nil c.unlabel_event(EVENT_ID, "payment")
    assert_equal "not_found", code_of { c.unlabel_event(EVENT_ID, "promo") }
  end

  def test_guard
    g = ->(**o) { Trace::Guard.new(secret_key: "sk_test", endpoint: api.endpoint, **o) }
    assert g.call.check(EVENT_ID).ok?
    out = g.call.check(nil)
    assert_equal [false, 400, "event_required"], [out.ok?, out.status, out.code]
    assert g.call(required: false).check("").ok?
    assert_equal 403, g.call(reject_score: 75).check(EVENT_ID).status
    assert g.call(reject_score: 76).check(EVENT_ID).ok?
    assert_equal 403, g.call(reject: ->(e) { e["visitorId"] != "" }).check(EVENT_ID).status
    assert_equal 400, g.call.check("01a1dcf6-53b8-7c68-bd1d-000000000000").status
    assert_equal 500, Trace::Guard.new(secret_key: "sk_wrong", endpoint: api.endpoint, fail_open: true).check(EVENT_ID).status
    assert_equal 503, Trace::Guard.new(secret_key: "sk_test", endpoint: "http://127.0.0.1:1", timeout: 0.5).check(EVENT_ID).status
    open = Trace::Guard.new(secret_key: "sk_test", endpoint: "http://127.0.0.1:1", timeout: 0.5, fail_open: true).check(EVENT_ID)
    assert open.ok?
    assert_nil open.event
  end

  def test_rack_middleware
    app = ->(env) { [200, {}, [env["trace.event"] ? env["trace.event"]["visitorId"] : "none"]] }
    mw = Trace::Rack::Guard.new(app, paths: ["/signup"], secret_key: "sk_test", endpoint: api.endpoint)
    env = lambda do |method, path, body: nil, type: nil, header: nil|
      e = { "REQUEST_METHOD" => method, "PATH_INFO" => path, "rack.input" => StringIO.new(body.to_s) }
      e["CONTENT_TYPE"] = type if type
      e["HTTP_X_TRACE_EVENT_ID"] = header if header
      e
    end

    status, _h, body = mw.call(env.call("POST", "/signup", body: JSON.generate("eventId" => EVENT_ID), type: "application/json"))
    assert_equal [200, EVENT["visitorId"]], [status, body.first]
    assert_equal 200, mw.call(env.call("POST", "/signup", header: EVENT_ID))[0]
    assert_equal 200, mw.call(env.call("POST", "/signup", body: "email=a%40b.test&eventId=#{EVENT_ID}", type: "application/x-www-form-urlencoded"))[0]
    assert_equal 400, mw.call(env.call("POST", "/signup", body: "{}", type: "application/json"))[0]
    assert_equal 200, mw.call(env.call("GET", "/signup"))[0], "GET is not guarded"
    assert_equal 200, mw.call(env.call("POST", "/other"))[0], "other paths are not guarded"

    # The body can be read again by the app.
    reader = ->(e) { [200, {}, [e["rack.input"].read]] }
    mw2 = Trace::Rack::Guard.new(reader, secret_key: "sk_test", endpoint: api.endpoint)
    payload = JSON.generate("eventId" => EVENT_ID, "email" => "a@b.test")
    assert_equal payload, mw2.call(env.call("POST", "/x", body: payload, type: "application/json"))[2].first
  end
end
