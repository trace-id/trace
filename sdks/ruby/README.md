# Trace (Ruby)

> **Unverified.** This SDK was written without a Ruby toolchain available, so it has not been run yet. Its tests are wired into CI (`sdks` job) and `node sdks/run-tests.mjs`; treat it as a draft until they pass.

Server SDK: verify events, webhooks and sealed results, label events for the fraud score, and guard Rack or Rails routes. Standard library only. Ruby 3.0+.

```sh
gem install trace-device   # or: gem "trace-device" in your Gemfile
```

```ruby
require "trace"

client = Trace::Client.new(ENV["TRACE_SECRET_KEY"], "https://id.example.com", timeout: 2.0)
begin
  event = client.get_event(params[:eventId])
rescue Trace::VerifyError => e
  # e.code: timeout, not_found, expired, unauthorized, ...; decide whether to fail open or closed
end
render json: { error: "blocked" }, status: 403 if event && event["suspectScore"] >= 60

# Fraud score: label outcomes per fraud type (a chargeback, or a review that cleared the user)
client.label_event(event_id, "payment", true)
client.unlabel_event(event_id, "payment")

# Webhooks: pass the raw body exactly as received
payload = Trace.verify_webhook(request.raw_post, request.headers["X-Signature"], ENV["TRACE_WEBHOOK_SECRET"])

# Sealed results (SEALED_RESULTS_KEY on the server), no API call
event = Trace.unseal_event_result(params[:sealedResult], ENV["TRACE_SEALED_KEY"])
```

## Guard

Rack middleware (Rails, Sinatra, Hanami). It reads the event id from the `X-Trace-Event-Id` header, a JSON body or a urlencoded form body, verifies it, and puts the event in `env["trace.event"]`. `TRACE_SECRET_KEY` and `TRACE_ENDPOINT` are read from the environment.

```ruby
# config/application.rb
config.middleware.use Trace::Rack::Guard, paths: ["/signup", %r{\A/api/}], reject_score: 80, fail_open: true

# in a controller
event = request.env["trace.event"] # nil only with fail_open when Trace was unreachable
```

Or call `Trace::Guard.new(...).check(event_id)` yourself: it returns an outcome with `ok?`, `event`, `status` and `body`.

Answers: 400 missing or invalid event, 403 rejected, 503 Trace unreachable (`fail_open: true` lets it through), 500 bad key or missing configuration (never fails open).

Tests: `ruby test/trace_test.rb` (they read `../test-vectors/vectors.json`).
