package trace

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type vectors struct {
	Sealed struct {
		Key      string `json:"key"`
		Valid    string `json:"valid"`
		Tampered string `json:"tampered"`
		Expired  string `json:"expired"`
		Expect   struct {
			EventID      string  `json:"eventId"`
			SuspectScore float64 `json:"suspectScore"`
		} `json:"expect"`
	} `json:"sealed"`
	Webhook struct {
		Secret       string `json:"secret"`
		Body         string `json:"body"`
		Signature    string `json:"signature"`
		BadSignature string `json:"badSignature"`
		NowAccepted  int64  `json:"nowAccepted"`
		NowTooLate   int64  `json:"nowTooLate"`
	} `json:"webhook"`
	EventID struct {
		Valid string `json:"valid"`
	} `json:"eventId"`
}

func loadVectors(t *testing.T) vectors {
	t.Helper()
	raw, err := os.ReadFile("../test-vectors/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func at(sec int64) func() time.Time { return func() time.Time { return time.Unix(sec, 0) } }

func TestWebhook(t *testing.T) {
	v := loadVectors(t).Webhook
	p, err := VerifyWebhook([]byte(v.Body), v.Signature, v.Secret, WithNow(at(v.NowAccepted)))
	if err != nil {
		t.Fatal(err)
	}
	if p.ID != "wh_1" {
		t.Fatalf("id = %q", p.ID)
	}
	e, ok := p.Event()
	if !ok || e.SuspectScore != 75 || !e.Detected("bot") {
		t.Fatalf("event = %+v ok=%v", e, ok)
	}

	cases := []struct {
		name, sig string
		now       int64
		code      string
	}{
		{"missing", "", v.NowAccepted, WebhookMissingSignature},
		{"malformed", "garbage", v.NowAccepted, WebhookMalformedSignature},
		{"stale", v.Signature, v.NowTooLate, WebhookTimestampRange},
		{"bad mac", v.BadSignature, v.NowAccepted, WebhookInvalidSignature},
	}
	for _, c := range cases {
		_, err := VerifyWebhook([]byte(v.Body), c.sig, v.Secret, WithNow(at(c.now)))
		var we *WebhookError
		if !errors.As(err, &we) || we.Code != c.code {
			t.Errorf("%s: err = %v, want %s", c.name, err, c.code)
		}
	}
	// A body altered by one byte must fail the MAC.
	_, err = VerifyWebhook([]byte(strings.Replace(v.Body, "wh_1", "wh_2", 1)), v.Signature, v.Secret, WithNow(at(v.NowAccepted)))
	var we *WebhookError
	if !errors.As(err, &we) || we.Code != WebhookInvalidSignature {
		t.Errorf("altered body: %v", err)
	}
}

func TestSealed(t *testing.T) {
	v := loadVectors(t).Sealed
	e, err := UnsealEventResult(v.Valid, v.Key)
	if err != nil {
		t.Fatal(err)
	}
	if e.EventID != v.Expect.EventID || e.SuspectScore != v.Expect.SuspectScore {
		t.Fatalf("event = %+v", e)
	}
	for name, c := range map[string]struct {
		sealed, key, code string
	}{
		"tampered":   {v.Tampered, v.Key, SealedTampered},
		"expired":    {v.Expired, v.Key, SealedExpired},
		"bad key":    {v.Valid, "short", SealedInvalidKey},
		"wrong key":  {v.Valid, "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=", SealedTampered},
		"not base64": {"!!!", v.Key, SealedMalformed},
		"too short":  {"AQID", v.Key, SealedMalformed},
	} {
		_, err := UnsealEventResult(c.sealed, c.key)
		var se *SealedError
		if !errors.As(err, &se) || se.Code != c.code {
			t.Errorf("%s: err = %v, want %s", name, err, c.code)
		}
	}
	if _, err := UnsealEventResult(v.Expired, v.Key, WithoutExpiryCheck()); err != nil {
		t.Errorf("expired without check: %v", err)
	}
	if _, err := UnsealEventResult(v.Valid, "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=", WithRotationKeys(v.Key)); err != nil {
		t.Errorf("rotation: %v", err)
	}
}

// fakeServer mirrors the stand-in API the other SDK tests use.
func fakeServer(t *testing.T, v vectors) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer sk_test" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"bad key"}}`))
			return
		}
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, v.EventID.Valid):
			var p struct {
				Data json.RawMessage `json:"data"`
			}
			_ = json.Unmarshal([]byte(v.Webhook.Body), &p)
			_, _ = w.Write(p.Data)
		case r.Method == http.MethodPut:
			parts := strings.Split(r.URL.Path, "/")
			label := parts[len(parts)-1]
			if label == "full" {
				w.WriteHeader(409)
				_, _ = w.Write([]byte(`{"error":{"code":"limit_reached","message":"too many types"}}`))
				return
			}
			var b struct {
				Fraud bool `json:"fraud"`
			}
			_ = json.NewDecoder(r.Body).Decode(&b)
			_ = json.NewEncoder(w).Encode(map[string]any{"eventId": parts[3], "label": label, "fraud": b.Fraud})
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/labels/payment"):
			w.WriteHeader(204)
		default:
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"error":{"code":"not_found","message":"Event not found"}}`))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func code(err error) string {
	var ve *VerifyError
	if errors.As(err, &ve) {
		return ve.Code
	}
	return "other:" + errString(err)
}

func errString(err error) string {
	if err == nil {
		return "nil"
	}
	return err.Error()
}

func TestClient(t *testing.T) {
	v := loadVectors(t)
	srv := fakeServer(t, v)
	ctx := context.Background()
	c, err := NewClient("sk_test", srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	e, err := c.GetEvent(ctx, v.EventID.Valid)
	if err != nil || e.SuspectScore != 75 || e.VisitorID == "" || len(e.Raw) == 0 {
		t.Fatalf("GetEvent = %+v, %v", e, err)
	}
	if got := code(func() error { _, err := c.GetEvent(ctx, "nope"); return err }()); got != CodeInvalidEventID {
		t.Errorf("bad id: %s", got)
	}
	if got := code(func() error { _, err := c.GetEvent(ctx, "01a1dcf6-53b8-7c68-bd1d-000000000000"); return err }()); got != CodeNotFound {
		t.Errorf("404: %s", got)
	}
	wrong, _ := NewClient("sk_wrong", srv.URL)
	if _, err := wrong.GetEvent(ctx, v.EventID.Valid); code(err) != CodeUnauthorized {
		t.Errorf("401: %v", err)
	}
	if _, err := NewClient("pk_public", srv.URL); code(err) != CodeUnauthorized {
		t.Errorf("public key: %v", err)
	}

	if err := c.LabelEvent(ctx, v.EventID.Valid, "payment", true); err != nil {
		t.Errorf("label: %v", err)
	}
	if got := code(c.LabelEvent(ctx, v.EventID.Valid, "Payment", true)); got != CodeInvalidLabel {
		t.Errorf("bad label: %s", got)
	}
	if got := code(c.LabelEvent(ctx, v.EventID.Valid, "full", true)); got != CodeLimitReached {
		t.Errorf("409: %s", got)
	}
	if err := c.UnlabelEvent(ctx, v.EventID.Valid, "payment"); err != nil {
		t.Errorf("unlabel: %v", err)
	}
	if got := code(c.UnlabelEvent(ctx, v.EventID.Valid, "promo")); got != CodeNotFound {
		t.Errorf("unlabel 404: %s", got)
	}
}

func TestClientTimeoutAndRedirect(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(300 * time.Millisecond) }))
	defer slow.Close()
	c, _ := NewClient("sk_test", slow.URL, WithTimeout(50*time.Millisecond))
	if _, err := c.GetEvent(context.Background(), loadVectors(t).EventID.Valid); code(err) != CodeTimeout {
		t.Errorf("timeout: %v", err)
	}

	leaked := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirect.Close()
	c2, _ := NewClient("sk_test", redirect.URL)
	if _, err := c2.GetEvent(context.Background(), loadVectors(t).EventID.Valid); err == nil || leaked {
		t.Errorf("redirect followed: err=%v leaked=%v", err, leaked)
	}
}

func TestGuard(t *testing.T) {
	v := loadVectors(t)
	srv := fakeServer(t, v)
	t.Setenv("TRACE_SECRET_KEY", "")
	t.Setenv("TRACE_ENDPOINT", "")
	run := func(opts GuardOptions, req *http.Request) (int, string, *Event) {
		var got *Event
		var bodySeen string
		h := Guard(opts)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got = EventFromContext(r.Context())
			buf := new(strings.Builder)
			if r.Body != nil {
				b := make([]byte, 4096)
				n, _ := r.Body.Read(b)
				buf.Write(b[:n])
			}
			bodySeen = buf.String()
			w.WriteHeader(200)
		}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, bodySeen, got
	}
	base := GuardOptions{SecretKey: "sk_test", Endpoint: srv.URL}
	jsonReq := func(body string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/signup", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		return r
	}

	status, body, ev := run(base, jsonReq(`{"eventId":"`+v.EventID.Valid+`","email":"a@b.test"}`))
	if status != 200 || ev == nil || ev.VisitorID == "" {
		t.Fatalf("json body: %d %+v", status, ev)
	}
	if !strings.Contains(body, "a@b.test") {
		t.Errorf("handler could not re-read the body: %q", body)
	}

	form := httptest.NewRequest(http.MethodPost, "/signup", strings.NewReader("email=a%40b.test&eventId="+v.EventID.Valid))
	form.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	status, body, ev = run(base, form)
	if status != 200 || ev == nil || !strings.Contains(body, "a%40b.test") {
		t.Errorf("form body: %d %q", status, body)
	}

	r := httptest.NewRequest(http.MethodPost, "/signup", nil)
	r.Header.Set("X-Trace-Event-Id", v.EventID.Valid)
	if status, _, ev := run(base, r); status != 200 || ev == nil {
		t.Errorf("header: %d", status)
	}
	if status, _, _ := run(base, jsonReq(`{}`)); status != 400 {
		t.Errorf("missing: %d", status)
	}
	opt := base
	opt.Optional = true
	if status, _, ev := run(opt, jsonReq(`{}`)); status != 200 || ev != nil {
		t.Errorf("optional: %d", status)
	}
	rej := base
	rej.RejectScore = 75
	if status, _, _ := run(rej, jsonReq(`{"eventId":"`+v.EventID.Valid+`"}`)); status != 403 {
		t.Errorf("reject score: %d", status)
	}
	cb := base
	cb.Reject = func(e *Event) bool { return e.Detected("bot") }
	if status, _, _ := run(cb, jsonReq(`{"eventId":"`+v.EventID.Valid+`"}`)); status != 403 {
		t.Errorf("reject callback: %d", status)
	}
	if status, _, _ := run(base, jsonReq(`{"eventId":"01a1dcf6-53b8-7c68-bd1d-000000000000"}`)); status != 400 {
		t.Errorf("unknown event: %d", status)
	}
	badKey := GuardOptions{SecretKey: "sk_wrong", Endpoint: srv.URL, FailOpen: true}
	if status, _, _ := run(badKey, jsonReq(`{"eventId":"`+v.EventID.Valid+`"}`)); status != 500 {
		t.Errorf("bad key must never fail open: %d", status)
	}
	if status, _, _ := run(GuardOptions{}, jsonReq(`{"eventId":"`+v.EventID.Valid+`"}`)); status != 500 {
		t.Errorf("missing config: %d", status)
	}
	down := GuardOptions{SecretKey: "sk_test", Endpoint: "http://127.0.0.1:1"}
	if status, _, _ := run(down, jsonReq(`{"eventId":"`+v.EventID.Valid+`"}`)); status != 503 {
		t.Errorf("unreachable: %d", status)
	}
	down.FailOpen = true
	if status, _, ev := run(down, jsonReq(`{"eventId":"`+v.EventID.Valid+`"}`)); status != 200 || ev != nil {
		t.Errorf("fail open: %d", status)
	}
}
