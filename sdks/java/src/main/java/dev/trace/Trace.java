package dev.trace;

import java.io.ByteArrayOutputStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Server SDK: verify events, webhooks and sealed results. No dependencies (Java 11+). Only the verified event should
 * drive decisions; whatever the browser sends you can be forged.
 */
public final class Trace {
    private static final Pattern EVENT_ID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    private static final Pattern LABEL = Pattern.compile("^[a-z][a-z0-9_]{0,31}$");
    private static final byte[] AAD = "trace-sealed-v1".getBytes(StandardCharsets.UTF_8);

    /**
     * code: invalid_event_id, invalid_label, timeout, network, unauthorized, not_found, expired, rate_limited, limit_reached,
     * server_error, invalid_response.
     */
    public static final class VerifyException extends Exception {
        private static final long serialVersionUID = 1L;
        public final String code;
        public final Integer status;

        VerifyException(String code, String message, Integer status) {
            super(message);
            this.code = code;
            this.status = status;
        }
    }

    /** code: missing_signature, malformed_signature, timestamp_out_of_range, invalid_signature, invalid_payload. */
    public static final class WebhookException extends Exception {
        private static final long serialVersionUID = 1L;
        public final String code;

        WebhookException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    /** code: invalid_key, malformed, unsupported_version, tampered, expired. */
    public static final class SealedResultException extends Exception {
        private static final long serialVersionUID = 1L;
        public final String code;

        SealedResultException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private final String secretKey;
    private final String endpoint;
    private final Duration timeout;
    private final HttpClient http;

    public Trace(String secretKey, String endpoint) throws VerifyException {
        this(secretKey, endpoint, Duration.ofSeconds(2));
    }

    public Trace(String secretKey, String endpoint, Duration timeout) throws VerifyException {
        if (secretKey == null || !secretKey.startsWith("sk_")) {
            throw new VerifyException("unauthorized", "secretKey must be a secret key (sk_...)", null);
        }
        this.secretKey = secretKey;
        this.endpoint = endpoint.replaceAll("/+$", "");
        this.timeout = timeout;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    /** The event, as GET /v1/events/:eventId returns it (objects are Maps, arrays Lists, numbers Doubles). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getEvent(String eventId) throws VerifyException {
        checkEventId(eventId);
        Response r = request("GET", "/v1/events/" + eventId, null);
        if (!(r.json instanceof Map)) throw new VerifyException("invalid_response", "Unexpected response shape", r.status);
        Map<String, Object> event = (Map<String, Object>) r.json;
        if (!(event.get("eventId") instanceof String) || !(event.get("visitorId") instanceof String)
                || !(event.get("suspectScore") instanceof Double) || !(event.get("reasons") instanceof List)
                || !(event.get("signals") instanceof Map)) {
            throw new VerifyException("invalid_response", "Unexpected response shape", r.status);
        }
        return event;
    }

    /**
     * Records your verdict on an event for one fraud type (e.g. "payment" after a chargeback, or false after a review
     * cleared it). Trace trains a model per type from these labels and adds fraudScores to new events. Labelling again
     * replaces the verdict.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> labelEvent(String eventId, String label, boolean fraud) throws VerifyException {
        checkEventId(eventId);
        checkLabel(label);
        Response r = request("PUT", "/v1/events/" + eventId + "/labels/" + label, "{\"fraud\":" + fraud + "}");
        Map<String, Object> m = r.json instanceof Map ? (Map<String, Object>) r.json : Map.of();
        if (!eventId.equals(m.get("eventId")) || !label.equals(m.get("label")) || !(m.get("fraud") instanceof Boolean)) {
            throw new VerifyException("invalid_response", "Unexpected response shape", r.status);
        }
        return m;
    }

    /** Removes a label; throws not_found when the event has no label of that type. */
    public void unlabelEvent(String eventId, String label) throws VerifyException {
        checkEventId(eventId);
        checkLabel(label);
        request("DELETE", "/v1/events/" + eventId + "/labels/" + label, null);
    }

    private static void checkEventId(String eventId) throws VerifyException {
        if (eventId == null || !EVENT_ID.matcher(eventId).matches()) {
            throw new VerifyException("invalid_event_id", "eventId is not a valid event id", null);
        }
    }

    private static void checkLabel(String label) throws VerifyException {
        if (label == null || !LABEL.matcher(label).matches()) {
            throw new VerifyException("invalid_label", "label must match ^[a-z][a-z0-9_]{0,31}$", null);
        }
    }

    private static final class Response {
        final int status;
        final Object json;

        Response(int status, Object json) {
            this.status = status;
            this.json = json;
        }
    }

    @SuppressWarnings("unchecked")
    private Response request(String method, String path, String body) throws VerifyException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(endpoint + path))
                .timeout(timeout)
                .header("Authorization", "Bearer " + secretKey)
                .header("Accept", "application/json");
        if (body != null) {
            b.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(body));
        } else {
            b.method(method, HttpRequest.BodyPublishers.noBody());
        }
        HttpResponse<String> res;
        try {
            res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
        } catch (HttpTimeoutException e) {
            throw new VerifyException("timeout", "Verification timed out", null);
        } catch (ConnectException e) {
            throw new VerifyException("network", "Connection failed", null);
        } catch (java.io.IOException e) {
            throw new VerifyException("network", String.valueOf(e.getMessage()), null);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new VerifyException("network", "Interrupted", null);
        }
        Object json;
        try {
            json = res.body() == null || res.body().isEmpty() ? null : Json.parse(res.body());
        } catch (RuntimeException e) {
            json = null;
        }
        int status = res.statusCode();
        if (status < 200 || status >= 300) {
            Object err = json instanceof Map ? ((Map<String, Object>) json).get("error") : null;
            Map<String, Object> e = err instanceof Map ? (Map<String, Object>) err : Map.of();
            String serverCode = e.get("code") instanceof String ? (String) e.get("code") : null;
            String message = e.get("message") instanceof String ? (String) e.get("message") : "HTTP " + status;
            throw new VerifyException(codeFor(status, serverCode), message, status);
        }
        return new Response(status, json);
    }

    private static String codeFor(int status, String serverCode) {
        if (status == 401 || status == 403) return "unauthorized";
        if (status == 404) return "not_found";
        if (status == 410 || "event_expired".equals(serverCode)) return "expired";
        if (status == 429) return "rate_limited";
        if (status == 400) return "invalid_label".equals(serverCode) ? "invalid_label" : "invalid_event_id";
        if (status == 409) return "limit_reached";
        return "server_error";
    }

    /**
     * Verifies the X-Signature header (t=&lt;unix&gt;,v1=&lt;hex hmac&gt;) against the raw request body and returns the
     * payload. Deliveries are at-least-once: dedupe on the payload id.
     */
    public static Map<String, Object> verifyWebhook(String body, String signature, String secret) throws WebhookException {
        return verifyWebhook(body, signature, secret, 300, Instant.now().getEpochSecond());
    }

    public static Map<String, Object> verifyWebhook(String body, String signature, String secret, long toleranceSec, long nowSec)
            throws WebhookException {
        if (signature == null || signature.isEmpty()) throw new WebhookException("missing_signature", "Missing X-Signature header");
        Long timestamp = null;
        List<String> macs = new ArrayList<>();
        for (String part : signature.split(",")) {
            String[] kv = part.trim().split("=", 2);
            if (kv.length != 2) continue;
            if (kv[0].equals("t") && kv[1].matches("\\d{1,12}")) timestamp = Long.parseLong(kv[1]);
            else if (kv[0].equals("v1") && kv[1].matches("[0-9a-f]{64}")) macs.add(kv[1]);
        }
        if (timestamp == null || macs.isEmpty()) throw new WebhookException("malformed_signature", "X-Signature is malformed");
        if (Math.abs(nowSec - timestamp) > toleranceSec) {
            throw new WebhookException("timestamp_out_of_range", "Webhook timestamp is outside the tolerance");
        }
        byte[] expected;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            expected = mac.doFinal((timestamp + "." + body).getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
        boolean valid = false;
        for (String m : macs) valid |= MessageDigest.isEqual(expected, hex(m));
        if (!valid) throw new WebhookException("invalid_signature", "Webhook signature does not match");
        Map<String, Object> payload;
        try {
            payload = Json.parseObject(body);
        } catch (RuntimeException e) {
            throw new WebhookException("invalid_payload", "Webhook body is not JSON");
        }
        if (!(payload.get("id") instanceof String) || !(payload.get("type") instanceof String) || !(payload.get("data") instanceof Map)) {
            throw new WebhookException("invalid_payload", "Webhook body has an unexpected shape");
        }
        return payload;
    }

    /**
     * Decrypts the sealedResult from an identify response with the server's SEALED_RESULTS_KEY; pass several keys during
     * a rotation. Authenticated, so it cannot be altered; still accept each eventId only once.
     */
    public static Map<String, Object> unsealEventResult(String sealedResult, List<String> keys) throws SealedResultException {
        return unsealEventResult(sealedResult, keys, true, Instant.now());
    }

    public static Map<String, Object> unsealEventResult(String sealedResult, List<String> keys, boolean checkExpiry, Instant now)
            throws SealedResultException {
        List<byte[]> keyBytes = new ArrayList<>();
        for (String k : keys) {
            byte[] b;
            try {
                b = Base64.getDecoder().decode(k);
            } catch (IllegalArgumentException e) {
                b = new byte[0];
            }
            if (b.length != 32) throw new SealedResultException("invalid_key", "The key must be base64 of exactly 32 bytes");
            keyBytes.add(b);
        }
        byte[] sealed;
        try {
            sealed = Base64.getUrlDecoder().decode(sealedResult);
        } catch (IllegalArgumentException e) {
            throw new SealedResultException("malformed", "Sealed result is not base64url");
        }
        if (sealed.length < 1 + 12 + 16 + 1) throw new SealedResultException("malformed", "Sealed result is too short");
        if (sealed[0] != 1) throw new SealedResultException("unsupported_version", "Unsupported sealed result version " + sealed[0]);
        byte[] plain = null;
        for (byte[] k : keyBytes) {
            try {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(k, "AES"), new GCMParameterSpec(128, sealed, 1, 12));
                c.updateAAD(AAD);
                plain = c.doFinal(sealed, 13, sealed.length - 13);
                break;
            } catch (GeneralSecurityException e) {
                // wrong key or altered: try the next key
            }
        }
        if (plain == null) throw new SealedResultException("tampered", "Sealed result failed authentication (wrong key or altered)");
        Map<String, Object> event;
        try {
            event = Json.parseObject(inflateRaw(plain));
        } catch (RuntimeException | DataFormatException e) {
            throw new SealedResultException("malformed", "Sealed result content is not valid");
        }
        if (checkExpiry) {
            Object exp = event.get("expiresAt");
            Instant expires;
            try {
                expires = Instant.parse(String.valueOf(exp));
            } catch (RuntimeException e) {
                expires = Instant.EPOCH;
            }
            if (expires.isBefore(now)) throw new SealedResultException("expired", "The event is past its verification window");
        }
        return event;
    }

    private static String inflateRaw(byte[] data) throws DataFormatException {
        Inflater inf = new Inflater(true);
        inf.setInput(data);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        while (!inf.finished()) {
            int n = inf.inflate(buf);
            if (n == 0 && (inf.needsInput() || inf.needsDictionary())) break;
            out.write(buf, 0, n);
        }
        inf.end();
        return out.toString(StandardCharsets.UTF_8);
    }

    private static byte[] hex(String s) {
        ByteBuffer b = ByteBuffer.allocate(s.length() / 2);
        for (int i = 0; i < s.length(); i += 2) b.put((byte) Integer.parseInt(s.substring(i, i + 2), 16));
        return b.array();
    }
}
