package trace

import (
	"bytes"
	"compress/flate"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"io"
	"strings"
	"time"
)

// SealedError codes.
const (
	SealedInvalidKey         = "invalid_key"
	SealedMalformed          = "malformed"
	SealedUnsupportedVersion = "unsupported_version"
	SealedTampered           = "tampered"
	SealedExpired            = "expired"
)

// SealedError is returned when a sealed result cannot be opened. Code is one of the Sealed* constants.
type SealedError struct {
	Code    string
	Message string
}

func (e *SealedError) Error() string { return "trace sealed: " + e.Code + ": " + e.Message }

type unsealConfig struct {
	keys        []string
	checkExpiry bool
	now         func() time.Time
}

// UnsealOption configures UnsealEventResult.
type UnsealOption func(*unsealConfig)

// WithRotationKeys adds older keys to try after the main one, for key rotation.
func WithRotationKeys(keys ...string) UnsealOption {
	return func(c *unsealConfig) { c.keys = append(c.keys, keys...) }
}

// WithoutExpiryCheck skips the verification-window check.
func WithoutExpiryCheck() UnsealOption { return func(c *unsealConfig) { c.checkExpiry = false } }

// WithUnsealNow replaces the clock, for tests.
func WithUnsealNow(now func() time.Time) UnsealOption { return func(c *unsealConfig) { c.now = now } }

var sealedAAD = []byte("trace-sealed-v1")

// UnsealEventResult decrypts the sealedResult from an identify response with the base64 32-byte key (the server's
// SEALED_RESULTS_KEY). It is authenticated, so it cannot be altered; still accept each EventID only once to stop
// replays.
func UnsealEventResult(sealed, key string, opts ...UnsealOption) (*Event, error) {
	cfg := unsealConfig{keys: []string{key}, checkExpiry: true, now: time.Now}
	for _, o := range opts {
		o(&cfg)
	}
	keys := make([][]byte, 0, len(cfg.keys))
	for _, k := range cfg.keys {
		raw, err := base64.StdEncoding.DecodeString(k)
		if err != nil || len(raw) != 32 {
			return nil, &SealedError{SealedInvalidKey, "The key must be base64 of exactly 32 bytes"}
		}
		keys = append(keys, raw)
	}
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(sealed, "="))
	if err != nil {
		return nil, &SealedError{SealedMalformed, "Sealed result is not base64url"}
	}
	if len(data) < 1+12+16+1 {
		return nil, &SealedError{SealedMalformed, "Sealed result is too short"}
	}
	if data[0] != 1 {
		return nil, &SealedError{SealedUnsupportedVersion, "Unsupported sealed result version"}
	}
	iv, body := data[1:13], data[13:]
	var plain []byte
	for _, k := range keys {
		block, err := aes.NewCipher(k)
		if err != nil {
			continue
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			continue
		}
		if p, err := gcm.Open(nil, iv, body, sealedAAD); err == nil {
			plain = p
			break
		}
	}
	if plain == nil {
		return nil, &SealedError{SealedTampered, "Sealed result failed authentication (wrong key or altered)"}
	}
	inflated, err := io.ReadAll(io.LimitReader(flate.NewReader(bytes.NewReader(plain)), 8<<20))
	if err != nil {
		return nil, &SealedError{SealedMalformed, "Sealed result content is not valid"}
	}
	e, ok := parseEvent(inflated)
	if !ok {
		return nil, &SealedError{SealedMalformed, "Sealed result content is not valid"}
	}
	if cfg.checkExpiry {
		exp, err := time.Parse(time.RFC3339Nano, e.ExpiresAt)
		if err != nil || exp.Before(cfg.now()) {
			return nil, &SealedError{SealedExpired, "The event is past its verification window"}
		}
	}
	return e, nil
}
