package trace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"
)

type ctxKey struct{}

// EventFromContext returns the verified event a Guard stored on the request, or nil (no event id was required, or
// FailOpen let the request through).
func EventFromContext(ctx context.Context) *Event {
	e, _ := ctx.Value(ctxKey{}).(*Event)
	return e
}

// GuardOptions configures Guard. Every field is optional.
type GuardOptions struct {
	// SecretKey and Endpoint default to the TRACE_SECRET_KEY and TRACE_ENDPOINT environment variables.
	SecretKey string
	Endpoint  string
	// Client replaces the Trace client entirely (tests, custom transport).
	Client *Client
	// Header carries the event id. Default X-Trace-Event-Id.
	Header string
	// BodyField is the JSON body field that carries the event id. Default eventId.
	BodyField string
	// Optional lets requests without an event id through. Default: reject them with 400.
	Optional bool
	// FailOpen lets requests through (event nil) when Trace is unreachable instead of answering 503. A wrong key or
	// missing configuration never fails open.
	FailOpen bool
	// RejectScore answers 403 when suspectScore is at or above it. Zero disables.
	RejectScore float64
	// Reject answers 403 when it returns true. Runs only on a verified event.
	Reject func(*Event) bool
}

// maxGuardBody caps how much of a JSON body is read to find the event id.
const maxGuardBody = 1 << 20

// Guard returns net/http middleware. It reads the event id from the X-Trace-Event-Id header or the JSON body, verifies
// it with your secret key, and puts the verified event on the request context (see EventFromContext).
//
// It answers 400 for a missing or invalid event, 403 when rejected, 503 when Trace cannot be reached and 500 for a bad
// key or missing configuration. It works with net/http, chi, gorilla/mux and anything that takes
// func(http.Handler) http.Handler.
func Guard(opts GuardOptions) func(http.Handler) http.Handler {
	header := opts.Header
	if header == "" {
		header = "X-Trace-Event-Id"
	}
	field := opts.BodyField
	if field == "" {
		field = "eventId"
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := strings.TrimSpace(r.Header.Get(header))
			if id == "" {
				id = bodyEventID(r, field)
			}
			event, status, code, msg := check(r.Context(), id, opts)
			if status != 0 {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, event)))
		})
	}
}

// bodyEventID reads the id from a JSON body and puts the body back so the handler can read it again.
func bodyEventID(r *http.Request, field string) string {
	mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	isJSON := mt == "application/json" || strings.HasSuffix(mt, "+json")
	if r.Body == nil || (!isJSON && mt != "application/x-www-form-urlencoded") {
		return ""
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxGuardBody+1))
	rest := r.Body
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(raw), rest), rest}
	if err != nil || len(raw) > maxGuardBody {
		return ""
	}
	if !isJSON {
		q, err := url.ParseQuery(string(raw))
		if err != nil {
			return ""
		}
		return strings.TrimSpace(q.Get(field))
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	id, _ := m[field].(string)
	return strings.TrimSpace(id)
}

// check returns the event, or a non-zero status with the error to send.
func check(ctx context.Context, id string, opts GuardOptions) (*Event, int, string, string) {
	if id == "" {
		if opts.Optional {
			return nil, 0, "", ""
		}
		return nil, http.StatusBadRequest, "event_required", "Missing Trace event id"
	}
	client := opts.Client
	if client == nil {
		key, endpoint := opts.SecretKey, opts.Endpoint
		if key == "" {
			key = os.Getenv("TRACE_SECRET_KEY")
		}
		if endpoint == "" {
			endpoint = os.Getenv("TRACE_ENDPOINT")
		}
		if key == "" || endpoint == "" {
			return nil, http.StatusInternalServerError, "trace_misconfigured", "Set SecretKey and Endpoint (or TRACE_SECRET_KEY and TRACE_ENDPOINT)"
		}
		c, err := NewClient(key, endpoint)
		if err != nil {
			return nil, http.StatusInternalServerError, "trace_misconfigured", "Trace rejected the secret key"
		}
		client = c
	}
	event, err := client.GetEvent(ctx, id)
	if err != nil {
		var ve *VerifyError
		if !errors.As(err, &ve) {
			return nil, http.StatusServiceUnavailable, "trace_unavailable", "Trace could not verify the event"
		}
		switch ve.Code {
		case CodeTimeout, CodeNetwork, CodeServerError, CodeRateLimited, CodeLimitReached, CodeInvalidResponse:
			if opts.FailOpen {
				return nil, 0, "", ""
			}
			return nil, http.StatusServiceUnavailable, "trace_unavailable", "Trace could not verify the event"
		case CodeUnauthorized:
			return nil, http.StatusInternalServerError, "trace_misconfigured", "Trace rejected the secret key"
		}
		return nil, http.StatusBadRequest, "event_invalid", "The Trace event id is invalid or expired"
	}
	if (opts.RejectScore > 0 && event.SuspectScore >= opts.RejectScore) || (opts.Reject != nil && opts.Reject(event)) {
		return nil, http.StatusForbidden, "trace_rejected", "Request rejected"
	}
	return event, 0, "", ""
}
