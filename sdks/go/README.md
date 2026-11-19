# Trace (Go)

Server SDK: verify events, webhooks and sealed results, label events for the fraud score, and guard `net/http` handlers. Standard library only. Go 1.21+.

```sh
go get github.com/trace-id/trace/sdks/go
```

```go
import trace "github.com/trace-id/trace/sdks/go"

client, _ := trace.NewClient(os.Getenv("TRACE_SECRET_KEY"), "https://id.example.com", trace.WithTimeout(2*time.Second))
event, err := client.GetEvent(ctx, eventID) // *trace.VerifyError with a Code on failure
if err == nil && (event.SuspectScore >= 60 || event.Detected("multiAccount")) {
	// ...
}

// Fraud score: label outcomes per fraud type (a chargeback, or a review that cleared the user)
_ = client.LabelEvent(ctx, eventID, "payment", true)
_ = client.UnlabelEvent(ctx, eventID, "payment")

// Webhooks: pass the raw body exactly as received
payload, err := trace.VerifyWebhook(rawBody, r.Header.Get("X-Signature"), os.Getenv("TRACE_WEBHOOK_SECRET"))

// Sealed results (SEALED_RESULTS_KEY on the server), no API call
event, err = trace.UnsealEventResult(sealedResult, os.Getenv("TRACE_SEALED_KEY"))
```

Middleware (reads `X-Trace-Event-Id` or the JSON body `eventId`; `TRACE_SECRET_KEY` and `TRACE_ENDPOINT` from the environment):

```go
guard := trace.Guard(trace.GuardOptions{RejectScore: 80})
mux.Handle("POST /signup", guard(handler)) // trace.EventFromContext(r.Context())
```

Answers: 400 missing or invalid event, 403 rejected, 503 Trace unreachable (`FailOpen: true` lets it through), 500 bad key or missing configuration (never fails open).

The module path is a placeholder until the repository's public home is fixed; change `go.mod` to match. Tests: `go test ./...` (they read `../test-vectors/vectors.json`).
