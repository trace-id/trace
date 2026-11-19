// Package trace is the Go server SDK for Trace: fetch a server-recorded event, verify a webhook signature, open a
// sealed result, and guard HTTP handlers. It uses only the standard library.
//
// Only the verified event should drive decisions. Whatever the browser sends you (a visitor ID, a score) can be forged.
package trace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Version of this SDK.
const Version = "0.1.0"

var (
	eventIDRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	labelRe   = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
)

// VerifyError codes.
const (
	CodeInvalidEventID  = "invalid_event_id"
	CodeInvalidLabel    = "invalid_label"
	CodeTimeout         = "timeout"
	CodeNetwork         = "network"
	CodeUnauthorized    = "unauthorized"
	CodeNotFound        = "not_found"
	CodeExpired         = "expired"
	CodeRateLimited     = "rate_limited"
	CodeLimitReached    = "limit_reached"
	CodeServerError     = "server_error"
	CodeInvalidResponse = "invalid_response"
)

// VerifyError is returned for every failed call to the Trace server. Code is one of the Code* constants.
type VerifyError struct {
	Code    string
	Message string
	// Status is the HTTP status, or 0 when there was no response.
	Status int
	// RetryAfter is set for rate limits when the server says how long to wait.
	RetryAfter time.Duration
}

func (e *VerifyError) Error() string { return "trace: " + e.Code + ": " + e.Message }

// Reason is one signal's contribution to the suspect score.
type Reason struct {
	Signal       string  `json:"signal"`
	Contribution float64 `json:"contribution"`
}

// Signal is one fraud signal's result.
type Signal struct {
	Detected bool           `json:"detected"`
	Details  map[string]any `json:"details,omitempty"`
}

// Event is a server-recorded identification event, as GET /v1/events/:eventId returns it.
type Event struct {
	EventID      string            `json:"eventId"`
	VisitorID    string            `json:"visitorId"`
	DeviceID     string            `json:"deviceId"`
	Confidence   float64           `json:"confidence"`
	MatchKind    string            `json:"matchKind"`
	SuspectScore float64           `json:"suspectScore"`
	Reasons      []Reason          `json:"reasons"`
	Signals      map[string]Signal `json:"signals"`
	LinkedID     *string           `json:"linkedId"`
	Tags         map[string]any    `json:"tags"`
	CreatedAt    string            `json:"createdAt"`
	ExpiresAt    string            `json:"expiresAt"`

	// Raw is the full JSON body, for fields this struct does not name (ip, botInfo, fraudScores, ...).
	Raw json.RawMessage `json:"-"`
}

// Detected reports whether the named signal fired.
func (e *Event) Detected(signal string) bool { return e.Signals[signal].Detected }

func parseEvent(raw []byte) (*Event, bool) {
	var probe map[string]json.RawMessage
	if json.Unmarshal(raw, &probe) != nil {
		return nil, false
	}
	for _, k := range []string{"eventId", "visitorId", "confidence", "suspectScore", "reasons", "signals"} {
		if _, ok := probe[k]; !ok {
			return nil, false
		}
	}
	var e Event
	if json.Unmarshal(raw, &e) != nil || e.EventID == "" || e.VisitorID == "" {
		return nil, false
	}
	e.Raw = append(json.RawMessage(nil), raw...)
	return &e, true
}

// Client fetches events with a secret key. It is safe for concurrent use.
type Client struct {
	secretKey string
	endpoint  string
	http      *http.Client
	timeout   time.Duration
}

// Option configures a Client.
type Option func(*Client)

// WithTimeout sets the per-call timeout. Default 2s. Decide yourself whether a timeout fails open or closed.
func WithTimeout(d time.Duration) Option { return func(c *Client) { c.timeout = d } }

// WithHTTPClient replaces the HTTP client. Redirects are never followed regardless: a redirect would resend the key.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// NewClient returns a Client for the server at endpoint (for example https://id.example.com). secretKey must be a
// secret key (sk_...); keep it on your server.
func NewClient(secretKey, endpoint string, opts ...Option) (*Client, error) {
	if !strings.HasPrefix(secretKey, "sk_") {
		return nil, &VerifyError{Code: CodeUnauthorized, Message: "secretKey must be a secret key (sk_...)"}
	}
	c := &Client{secretKey: secretKey, endpoint: strings.TrimRight(endpoint, "/"), timeout: 2 * time.Second}
	for _, o := range opts {
		o(c)
	}
	if c.http == nil {
		c.http = &http.Client{}
	}
	hc := *c.http
	hc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	c.http = &hc
	return c, nil
}

// GetEvent fetches the full, server-recorded event.
func (c *Client) GetEvent(ctx context.Context, eventID string) (*Event, error) {
	if err := checkEventID(eventID); err != nil {
		return nil, err
	}
	status, raw, err := c.request(ctx, http.MethodGet, "/v1/events/"+eventID, nil)
	if err != nil {
		return nil, err
	}
	e, ok := parseEvent(raw)
	if !ok {
		return nil, &VerifyError{Code: CodeInvalidResponse, Message: "Unexpected response shape", Status: status}
	}
	return e, nil
}

// LabelEvent records your verdict on an event for one fraud type (for example "payment" after a chargeback, or
// fraud=false after a review cleared it). Trace trains a model per type from these labels. Labelling again replaces the
// verdict.
func (c *Client) LabelEvent(ctx context.Context, eventID, label string, fraud bool) error {
	if err := checkEventID(eventID); err != nil {
		return err
	}
	if err := checkLabel(label); err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]bool{"fraud": fraud})
	status, raw, err := c.request(ctx, http.MethodPut, "/v1/events/"+eventID+"/labels/"+label, body)
	if err != nil {
		return err
	}
	var r struct {
		EventID string `json:"eventId"`
		Label   string `json:"label"`
		Fraud   *bool  `json:"fraud"`
	}
	if json.Unmarshal(raw, &r) != nil || r.EventID != eventID || r.Label != label || r.Fraud == nil {
		return &VerifyError{Code: CodeInvalidResponse, Message: "Unexpected response shape", Status: status}
	}
	return nil
}

// UnlabelEvent removes a label. It returns a not_found error when the event has no label of that type.
func (c *Client) UnlabelEvent(ctx context.Context, eventID, label string) error {
	if err := checkEventID(eventID); err != nil {
		return err
	}
	if err := checkLabel(label); err != nil {
		return err
	}
	_, _, err := c.request(ctx, http.MethodDelete, "/v1/events/"+eventID+"/labels/"+label, nil)
	return err
}

func checkEventID(id string) error {
	if !eventIDRe.MatchString(id) {
		return &VerifyError{Code: CodeInvalidEventID, Message: "eventID is not a valid event id"}
	}
	return nil
}

func checkLabel(label string) error {
	if !labelRe.MatchString(label) {
		return &VerifyError{Code: CodeInvalidLabel, Message: "label must match ^[a-z][a-z0-9_]{0,31}$"}
	}
	return nil
}

func codeFor(status int, serverCode string) string {
	switch {
	case status == 401 || status == 403:
		return CodeUnauthorized
	case status == 404:
		return CodeNotFound
	case status == 410 || serverCode == "event_expired":
		return CodeExpired
	case status == 429:
		return CodeRateLimited
	case status == 400:
		if serverCode == "invalid_label" {
			return CodeInvalidLabel
		}
		return CodeInvalidEventID
	case status == 409:
		return CodeLimitReached
	}
	return CodeServerError
}

func (c *Client) request(ctx context.Context, method, path string, body []byte) (int, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.endpoint+path, rdr)
	if err != nil {
		return 0, nil, &VerifyError{Code: CodeNetwork, Message: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return 0, nil, &VerifyError{Code: CodeTimeout, Message: "Verification timed out"}
		}
		return 0, nil, &VerifyError{Code: CodeNetwork, Message: err.Error()}
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		var env struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &env)
		msg := env.Error.Message
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", res.StatusCode)
		}
		ve := &VerifyError{Code: codeFor(res.StatusCode, env.Error.Code), Message: msg, Status: res.StatusCode}
		if secs, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil && secs > 0 {
			ve.RetryAfter = time.Duration(secs) * time.Second
		}
		return res.StatusCode, nil, ve
	}
	return res.StatusCode, raw, nil
}
