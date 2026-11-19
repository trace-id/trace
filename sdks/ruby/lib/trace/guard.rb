require "json"
require "uri"

module Trace
  # Framework-neutral guard: verifies the event id a request carries with your secret key, then lets your rules decide.
  # The Rack middleware below wraps it; use it directly in a Rails controller or any other framework.
  #
  #   outcome = Trace::Guard.new(reject_score: 80).check(request.headers["X-Trace-Event-Id"] || params[:eventId])
  #   render json: outcome.body, status: outcome.status unless outcome.ok?
  #   event = outcome.event # nil only with fail_open or required: false
  #
  # Answers: 400 missing or invalid event, 403 rejected, 503 Trace unreachable, 500 bad key or missing configuration.
  # fail_open only covers "unreachable"; a wrong key never fails open.
  class Guard
    TRANSIENT = %w[timeout network server_error rate_limited limit_reached invalid_response].freeze

    Outcome = Struct.new(:ok, :event, :status, :code, :message) do
      def ok?
        ok
      end

      def body
        { "error" => { "code" => code, "message" => message } }
      end
    end

    # secret_key and endpoint default to the TRACE_SECRET_KEY and TRACE_ENDPOINT environment variables.
    # reject: a callable that gets the verified event (a Hash) and returns true to answer 403.
    def initialize(secret_key: nil, endpoint: nil, timeout: 2.0, required: true, fail_open: false, reject: nil, reject_score: nil)
      @secret_key = secret_key
      @endpoint = endpoint
      @timeout = timeout
      @required = required
      @fail_open = fail_open
      @reject = reject
      @reject_score = reject_score
    end

    def check(event_id)
      id = event_id.to_s.strip
      if id.empty?
        return @required ? failure(400, "event_required", "Missing Trace event id") : success(nil)
      end

      key = @secret_key || ENV["TRACE_SECRET_KEY"]
      endpoint = @endpoint || ENV["TRACE_ENDPOINT"]
      if key.to_s.empty? || endpoint.to_s.empty?
        return failure(500, "trace_misconfigured", "Set secret_key and endpoint (or TRACE_SECRET_KEY and TRACE_ENDPOINT)")
      end

      begin
        event = Client.new(key, endpoint, timeout: @timeout).get_event(id)
      rescue VerifyError => e
        return failure(500, "trace_misconfigured", "Trace rejected the secret key") if e.code == "unauthorized"
        if TRANSIENT.include?(e.code)
          return @fail_open ? success(nil) : failure(503, "trace_unavailable", "Trace could not verify the event")
        end

        return failure(400, "event_invalid", "The Trace event id is invalid or expired")
      end

      if (@reject_score && event["suspectScore"].to_f >= @reject_score) || (@reject && @reject.call(event))
        return failure(403, "trace_rejected", "Request rejected")
      end

      success(event)
    end

    private

    def success(event)
      Outcome.new(true, event, 200, "", "")
    end

    def failure(status, code, message)
      Outcome.new(false, nil, status, code, message)
    end
  end

  module Rack
    # Rack middleware (Rails, Sinatra, Hanami). Guards the requests that match `paths` and `methods`; everything else
    # passes through untouched. The verified event is in env["trace.event"].
    #
    #   # config/application.rb
    #   config.middleware.use Trace::Rack::Guard, paths: ["/signup", %r{\A/api/}], reject_score: 80, fail_open: true
    #
    # The event id comes from the X-Trace-Event-Id header, a JSON body or a urlencoded form body. The body is rewound
    # afterwards, so your app can read it again.
    class Guard
      MAX_BODY = 1 << 20

      def initialize(app, paths: nil, methods: %w[POST PUT PATCH DELETE], header: "HTTP_X_TRACE_EVENT_ID", body_field: "eventId", **guard_options)
        @app = app
        @paths = Array(paths)
        @methods = methods
        @header = header
        @body_field = body_field
        @guard = Trace::Guard.new(**guard_options)
      end

      def call(env)
        return @app.call(env) unless guarded?(env)

        outcome = @guard.check(event_id(env))
        unless outcome.ok?
          return [outcome.status, { "content-type" => "application/json" }, [JSON.generate(outcome.body)]]
        end

        env["trace.event"] = outcome.event
        @app.call(env)
      end

      private

      def guarded?(env)
        return false unless @methods.include?(env["REQUEST_METHOD"])
        return true if @paths.empty?

        path = env["PATH_INFO"].to_s
        @paths.any? { |p| p.is_a?(Regexp) ? p.match?(path) : p == path }
      end

      def event_id(env)
        header = env[@header].to_s.strip
        return header unless header.empty?

        type = env["CONTENT_TYPE"].to_s.downcase
        json = type.include?("json")
        form = type.include?("application/x-www-form-urlencoded")
        return nil unless json || form

        input = env["rack.input"]
        return nil unless input

        raw = input.read(MAX_BODY + 1).to_s
        input.rewind if input.respond_to?(:rewind)
        return nil if raw.bytesize > MAX_BODY

        if json
          parsed = JSON.parse(raw)
          parsed.is_a?(Hash) && parsed[@body_field].is_a?(String) ? parsed[@body_field] : nil
        else
          URI.decode_www_form(raw).to_h[@body_field]
        end
      rescue JSON::ParserError, ArgumentError
        nil
      end
    end
  end
end
