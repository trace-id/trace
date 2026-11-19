package trace

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// WebhookError codes.
const (
	WebhookMissingSignature   = "missing_signature"
	WebhookMalformedSignature = "malformed_signature"
	WebhookTimestampRange     = "timestamp_out_of_range"
	WebhookInvalidSignature   = "invalid_signature"
	WebhookInvalidPayload     = "invalid_payload"
)

// WebhookError is returned when a webhook delivery cannot be trusted. Code is one of the Webhook* constants.
type WebhookError struct {
	Code    string
	Message string
}

func (e *WebhookError) Error() string { return "trace webhook: " + e.Code + ": " + e.Message }

// WebhookPayload is a verified delivery. Deliveries are at-least-once: dedupe on ID.
type WebhookPayload struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	CreatedAt string          `json:"createdAt"`
	Data      json.RawMessage `json:"data"`
}

// Event decodes Data as an Event, for event.* deliveries.
func (p *WebhookPayload) Event() (*Event, bool) { return parseEvent(p.Data) }

type webhookConfig struct {
	tolerance time.Duration
	now       func() time.Time
}

// WebhookOption configures VerifyWebhook.
type WebhookOption func(*webhookConfig)

// WithTolerance sets how far the signed timestamp may be from now. Default 5 minutes.
func WithTolerance(d time.Duration) WebhookOption { return func(c *webhookConfig) { c.tolerance = d } }

// WithNow replaces the clock, for tests.
func WithNow(now func() time.Time) WebhookOption { return func(c *webhookConfig) { c.now = now } }

var (
	tsRe  = regexp.MustCompile(`^\d{1,12}$`)
	macRe = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// VerifyWebhook checks the X-Signature header (t=<unix>,v1=<hex hmac>) against the raw request body and returns the
// payload. Pass the body exactly as received, before any JSON parsing.
func VerifyWebhook(body []byte, signature, secret string, opts ...WebhookOption) (*WebhookPayload, error) {
	cfg := webhookConfig{tolerance: 5 * time.Minute, now: time.Now}
	for _, o := range opts {
		o(&cfg)
	}
	if signature == "" {
		return nil, &WebhookError{WebhookMissingSignature, "Missing X-Signature header"}
	}
	var ts int64 = -1
	var macs []string
	for _, part := range strings.Split(signature, ",") {
		k, v, _ := strings.Cut(strings.TrimSpace(part), "=")
		switch {
		case k == "t" && tsRe.MatchString(v):
			ts, _ = strconv.ParseInt(v, 10, 64)
		case k == "v1" && macRe.MatchString(v):
			macs = append(macs, v)
		}
	}
	if ts < 0 || len(macs) == 0 {
		return nil, &WebhookError{WebhookMalformedSignature, "X-Signature is malformed"}
	}
	diff := cfg.now().Unix() - ts
	if diff < 0 {
		diff = -diff
	}
	if time.Duration(diff)*time.Second > cfg.tolerance {
		return nil, &WebhookError{WebhookTimestampRange, "Webhook timestamp is outside the tolerance"}
	}
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(strconv.FormatInt(ts, 10) + "."))
	h.Write(body)
	expected := h.Sum(nil)
	valid := false
	for _, m := range macs {
		got, err := hex.DecodeString(m)
		if err == nil && hmac.Equal(expected, got) {
			valid = true
		}
	}
	if !valid {
		return nil, &WebhookError{WebhookInvalidSignature, "Webhook signature does not match"}
	}
	var p WebhookPayload
	if json.Unmarshal(body, &p) != nil || p.ID == "" || p.Type == "" || len(p.Data) == 0 || p.Data[0] != '{' {
		return nil, &WebhookError{WebhookInvalidPayload, "Webhook body has an unexpected shape"}
	}
	return &p, nil
}
