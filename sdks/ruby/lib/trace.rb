# Server SDK for Trace: fetch a server-recorded event, verify a webhook signature, open a sealed result and guard
# Rack or Rails routes. Standard library only.
#
# Only the verified event should drive decisions. Whatever the browser sends you (a visitor ID, a score) can be forged.
require "base64"
require "json"
require "net/http"
require "openssl"
require "time"
require "uri"
require "zlib"
require_relative "trace/version"

module Trace
  EVENT_ID = /\A[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/.freeze
  LABEL = /\A[a-z][a-z0-9_]{0,31}\z/.freeze

  # code: invalid_event_id, invalid_label, timeout, network, unauthorized, not_found, expired, rate_limited,
  # limit_reached, server_error, invalid_response
  class VerifyError < StandardError
    attr_reader :code, :status, :retry_after

    def initialize(code, message, status = nil, retry_after = nil)
      super(message)
      @code = code
      @status = status
      @retry_after = retry_after
    end
  end

  # code: missing_signature, malformed_signature, timestamp_out_of_range, invalid_signature, invalid_payload
  class WebhookError < StandardError
    attr_reader :code

    def initialize(code, message)
      super(message)
      @code = code
    end
  end

  # code: invalid_key, malformed, unsupported_version, tampered, expired
  class SealedError < StandardError
    attr_reader :code

    def initialize(code, message)
      super(message)
      @code = code
    end
  end

  # Constant-time string comparison.
  def self.secure_equal?(a, b)
    return false unless a.bytesize == b.bytesize

    result = 0
    a.bytes.zip(b.bytes) { |x, y| result |= x ^ y }
    result.zero?
  end

  def self.event?(value)
    value.is_a?(Hash) &&
      value["eventId"].is_a?(String) &&
      value["visitorId"].is_a?(String) &&
      value["confidence"].is_a?(Numeric) &&
      value["suspectScore"].is_a?(Numeric) &&
      value["reasons"].is_a?(Array) &&
      value["signals"].is_a?(Hash)
  end

  # Fetches events with a secret key. Safe to share between threads.
  class Client
    def initialize(secret_key, endpoint, timeout: 2.0)
      raise VerifyError.new("unauthorized", "secret_key must be a secret key (sk_...)") unless secret_key.to_s.start_with?("sk_")

      @secret_key = secret_key
      @endpoint = endpoint.to_s.sub(%r{/+\z}, "")
      @timeout = timeout
    end

    # The full, server-recorded event as a Hash with string keys.
    def get_event(event_id)
      check_event_id!(event_id)
      status, body = request("GET", "/v1/events/#{event_id}")
      raise VerifyError.new("invalid_response", "Unexpected response shape", status) unless Trace.event?(body)

      body
    end

    # Records your verdict on an event for one fraud type. Labelling again replaces the verdict.
    def label_event(event_id, label, fraud)
      check_event_id!(event_id)
      check_label!(label)
      raise ArgumentError, "fraud must be true or false" unless [true, false].include?(fraud)

      status, body = request("PUT", "/v1/events/#{event_id}/labels/#{label}", { "fraud" => fraud })
      unless body.is_a?(Hash) && body["eventId"] == event_id && body["label"] == label && [true, false].include?(body["fraud"])
        raise VerifyError.new("invalid_response", "Unexpected response shape", status)
      end

      body
    end

    # Removes a label; raises not_found when the event has no label of that type.
    def unlabel_event(event_id, label)
      check_event_id!(event_id)
      check_label!(label)
      request("DELETE", "/v1/events/#{event_id}/labels/#{label}")
      nil
    end

    private

    def check_event_id!(event_id)
      raise VerifyError.new("invalid_event_id", "event_id is not a valid event id") unless EVENT_ID.match?(event_id.to_s)
    end

    def check_label!(label)
      raise VerifyError.new("invalid_label", "label must match ^[a-z][a-z0-9_]{0,31}$") unless LABEL.match?(label.to_s)
    end

    def code_for(status, server_code)
      case status
      when 401, 403 then "unauthorized"
      when 404 then "not_found"
      when 410 then "expired"
      when 429 then "rate_limited"
      when 400 then server_code == "invalid_label" ? "invalid_label" : "invalid_event_id"
      when 409 then "limit_reached"
      else server_code == "event_expired" ? "expired" : "server_error"
      end
    end

    def request(method, path, payload = nil)
      uri = URI.parse("#{@endpoint}#{path}")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = @timeout
      http.read_timeout = @timeout
      http.write_timeout = @timeout
      klass = { "GET" => Net::HTTP::Get, "PUT" => Net::HTTP::Put, "DELETE" => Net::HTTP::Delete }.fetch(method)
      req = klass.new(uri.request_uri)
      req["Authorization"] = "Bearer #{@secret_key}"
      req["Accept"] = "application/json"
      if payload
        req["Content-Type"] = "application/json"
        req.body = JSON.generate(payload)
      end
      # Net::HTTP does not follow redirects, so the key is never resent elsewhere.
      res = http.request(req)
      status = res.code.to_i
      parsed = parse_json(res.body)
      if status >= 300
        error = parsed.is_a?(Hash) && parsed["error"].is_a?(Hash) ? parsed["error"] : {}
        retry_after = Integer(res["Retry-After"], exception: false)
        raise VerifyError.new(code_for(status, error["code"]), error["message"].is_a?(String) ? error["message"] : "HTTP #{status}", status, retry_after)
      end
      [status, parsed]
    rescue Net::OpenTimeout, Net::ReadTimeout, Net::WriteTimeout
      raise VerifyError.new("timeout", "Verification timed out")
    rescue SocketError, SystemCallError, OpenSSL::SSL::SSLError, EOFError, IOError => e
      raise VerifyError.new("network", e.message)
    end

    def parse_json(raw)
      raw.nil? || raw.empty? ? nil : JSON.parse(raw)
    rescue JSON::ParserError
      nil
    end
  end

  # Verifies the X-Signature header (t=<unix>,v1=<hex hmac>) against the raw request body and returns the payload.
  # Pass the body exactly as received. Deliveries are at least once: dedupe on payload["id"].
  def self.verify_webhook(body, signature, secret, tolerance: 300, now: Time.now.to_i)
    raise WebhookError.new("missing_signature", "Missing X-Signature header") if signature.nil? || signature.empty?

    timestamp = nil
    macs = []
    signature.split(",").each do |part|
      key, value = part.strip.split("=", 2)
      if key == "t" && value.to_s.match?(/\A\d{1,12}\z/)
        timestamp = value.to_i
      elsif key == "v1" && value.to_s.match?(/\A[0-9a-f]{64}\z/)
        macs << value
      end
    end
    raise WebhookError.new("malformed_signature", "X-Signature is malformed") if timestamp.nil? || macs.empty?
    raise WebhookError.new("timestamp_out_of_range", "Webhook timestamp is outside the tolerance") if (now - timestamp).abs > tolerance

    raw = body.to_s.b
    expected = OpenSSL::HMAC.hexdigest("SHA256", secret, "#{timestamp}.".b + raw)
    raise WebhookError.new("invalid_signature", "Webhook signature does not match") unless macs.any? { |mac| secure_equal?(expected, mac) }

    payload = begin
      JSON.parse(raw.dup.force_encoding("UTF-8"))
    rescue JSON::ParserError
      nil
    end
    unless payload.is_a?(Hash) && payload["id"].is_a?(String) && payload["type"].is_a?(String) && payload["data"].is_a?(Hash)
      raise WebhookError.new("invalid_payload", "Webhook body has an unexpected shape")
    end

    payload
  end

  SEALED_AAD = "trace-sealed-v1".b.freeze

  # Decrypts the sealedResult from an identify response with the base64 32-byte key (the server's SEALED_RESULTS_KEY).
  # Pass several keys during a rotation. It is authenticated, so it cannot be altered; still accept each eventId only
  # once to stop replays.
  def self.unseal_event_result(sealed_result, key, check_expiry: true, now: Time.now)
    keys = Array(key).map do |k|
      raw = begin
        Base64.strict_decode64(k.to_s)
      rescue ArgumentError
        "".b
      end
      raise SealedError.new("invalid_key", "The key must be base64 of exactly 32 bytes") unless raw.bytesize == 32

      raw
    end
    data = begin
      Base64.urlsafe_decode64(sealed_result.to_s)
    rescue ArgumentError
      raise SealedError.new("malformed", "Sealed result is not base64url")
    end
    raise SealedError.new("malformed", "Sealed result is too short") if data.bytesize < 1 + 12 + 16 + 1
    raise SealedError.new("unsupported_version", "Unsupported sealed result version") unless data.getbyte(0) == 1

    iv = data.byteslice(1, 12)
    encrypted = data.byteslice(13, data.bytesize - 13)
    ciphertext = encrypted.byteslice(0, encrypted.bytesize - 16)
    tag = encrypted.byteslice(encrypted.bytesize - 16, 16)

    plain = nil
    keys.each do |k|
      cipher = OpenSSL::Cipher.new("aes-256-gcm")
      cipher.decrypt
      cipher.key = k
      cipher.iv = iv
      cipher.auth_tag = tag
      cipher.auth_data = SEALED_AAD
      plain = cipher.update(ciphertext) + cipher.final
      break
    rescue OpenSSL::Cipher::CipherError
      plain = nil
    end
    raise SealedError.new("tampered", "Sealed result failed authentication (wrong key or altered)") if plain.nil?

    event = begin
      JSON.parse(Zlib::Inflate.new(-Zlib::MAX_WBITS).inflate(plain).force_encoding("UTF-8"))
    rescue Zlib::Error, JSON::ParserError
      raise SealedError.new("malformed", "Sealed result content is not valid")
    end
    raise SealedError.new("malformed", "Sealed result content is not valid") unless event.is_a?(Hash)

    if check_expiry
      expires = begin
        Time.iso8601(event["expiresAt"].to_s)
      rescue ArgumentError
        Time.at(0)
      end
      raise SealedError.new("expired", "The event is past its verification window") if expires < now
    end
    event
  end
end

require_relative "trace/guard"
