package dev.trace;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;

/** Dependency-free tests against the shared vectors. Run from sdks/java (see README). */
public final class TraceTest {
    private static int passed;
    private static int failed;

    private static void check(boolean ok, String name) {
        if (ok) passed++;
        else {
            failed++;
            System.err.println("FAIL: " + name);
        }
    }

    private static String code(Callable<?> fn) {
        try {
            fn.call();
            return "ok";
        } catch (Trace.VerifyException e) {
            return e.code;
        } catch (Trace.WebhookException e) {
            return e.code;
        } catch (Trace.SealedResultException e) {
            return e.code;
        } catch (Exception e) {
            return "unexpected:" + e;
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        Map<String, Object> v = Json.parseObject(Files.readString(Path.of("../test-vectors/vectors.json")));
        Map<String, Object> w = (Map<String, Object>) v.get("webhook");
        String body = (String) w.get("body");
        String sig = (String) w.get("signature");
        String secret = (String) w.get("secret");
        long ok = ((Double) w.get("nowAccepted")).longValue();
        long late = ((Double) w.get("nowTooLate")).longValue();

        Map<String, Object> p = Trace.verifyWebhook(body, sig, secret, 300, ok);
        check("wh_1".equals(p.get("id")), "webhook valid");
        check(code(() -> Trace.verifyWebhook(body, null, secret, 300, ok)).equals("missing_signature"), "webhook missing");
        check(code(() -> Trace.verifyWebhook(body, "garbage", secret, 300, ok)).equals("malformed_signature"), "webhook malformed");
        check(code(() -> Trace.verifyWebhook(body, sig, secret, 300, late)).equals("timestamp_out_of_range"), "webhook stale");
        check(code(() -> Trace.verifyWebhook(body, (String) w.get("badSignature"), secret, 300, ok)).equals("invalid_signature"), "webhook bad mac");

        Map<String, Object> s = (Map<String, Object>) v.get("sealed");
        String key = (String) s.get("key");
        Map<String, Object> e = Trace.unsealEventResult((String) s.get("valid"), List.of(key));
        check(((Map<String, Object>) s.get("expect")).get("eventId").equals(e.get("eventId")) && e.get("suspectScore").equals(75.0), "sealed valid");
        String zeros = java.util.Base64.getEncoder().encodeToString(new byte[32]);
        check(Trace.unsealEventResult((String) s.get("valid"), List.of(zeros, key)).get("suspectScore").equals(75.0), "sealed rotation");
        check(code(() -> Trace.unsealEventResult((String) s.get("tampered"), List.of(key))).equals("tampered"), "sealed tampered");
        check(code(() -> Trace.unsealEventResult((String) s.get("expired"), List.of(key))).equals("expired"), "sealed expired");
        check(code(() -> Trace.unsealEventResult("abc", List.of(key))).equals("malformed"), "sealed malformed");
        check(code(() -> Trace.unsealEventResult((String) s.get("valid"), List.of("short"))).equals("invalid_key"), "sealed bad key");

        String validId = (String) ((Map<String, Object>) v.get("eventId")).get("valid");
        String eventJson = Json.parseObject(body).get("data") == null ? "{}" : body.substring(body.indexOf("\"data\":") + 7, body.length() - 1);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            String auth = ex.getRequestHeaders().getFirst("Authorization");
            int status;
            String out;
            if (!"Bearer sk_test".equals(auth)) {
                status = 401;
                out = "{\"error\":{\"code\":\"unauthorized\",\"message\":\"bad key\"}}";
            } else if ("PUT".equals(ex.getRequestMethod())) {
                String reqBody = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String[] parts = ex.getRequestURI().getPath().split("/");
                String label = parts[parts.length - 1];
                if ("full".equals(label)) {
                    status = 409;
                    out = "{\"error\":{\"code\":\"limit_reached\",\"message\":\"too many types\"}}";
                } else {
                    status = 200;
                    out = "{\"eventId\":\"" + parts[3] + "\",\"label\":\"" + label + "\",\"fraud\":" + reqBody.contains("true") + "}";
                }
            } else if ("DELETE".equals(ex.getRequestMethod()) && ex.getRequestURI().getPath().endsWith("/labels/payment")) {
                ex.sendResponseHeaders(204, -1);
                ex.close();
                return;
            } else if (ex.getRequestURI().getPath().endsWith(validId)) {
                status = 200;
                out = eventJson;
            } else {
                status = 404;
                out = "{\"error\":{\"code\":\"not_found\",\"message\":\"Event not found\"}}";
            }
            byte[] bytes = out.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(status, bytes.length);
            ex.getResponseBody().write(bytes);
            ex.close();
        });
        server.start();
        try {
            String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
            check(new Trace("sk_test", endpoint).getEvent(validId).get("suspectScore").equals(75.0), "getEvent");
            check(code(() -> new Trace("sk_test", endpoint).getEvent("nope")).equals("invalid_event_id"), "getEvent bad id");
            check(code(() -> new Trace("sk_wrong", endpoint).getEvent(validId)).equals("unauthorized"), "getEvent 401");
            check(code(() -> new Trace("sk_test", endpoint).getEvent("01a1dcf6-53b8-7c68-bd1d-000000000000")).equals("not_found"), "getEvent 404");
            check(code(() -> new Trace("pk_public", endpoint)).equals("unauthorized"), "public key refused");
            Trace t = new Trace("sk_test", endpoint);
            check(t.labelEvent(validId, "payment", true).equals(Map.of("eventId", validId, "label", "payment", "fraud", true)), "labelEvent");
            check(Boolean.FALSE.equals(t.labelEvent(validId, "payment", false).get("fraud")), "labelEvent legit");
            t.unlabelEvent(validId, "payment");
            check(code(() -> t.labelEvent(validId, "Payment", true)).equals("invalid_label"), "labelEvent bad label");
            check(code(() -> t.labelEvent("nope", "payment", true)).equals("invalid_event_id"), "labelEvent bad id");
            check(code(() -> t.labelEvent(validId, "full", true)).equals("limit_reached"), "labelEvent 409");
            check(code(() -> { t.unlabelEvent(validId, "promo"); return null; }).equals("not_found"), "unlabelEvent 404");
        } finally {
            server.stop(0);
        }
        check(Instant.parse("2099-01-01T00:00:00.000Z").isAfter(Instant.now()), "sanity");

        System.out.println(passed + " passed, " + failed + " failed");
        if (failed > 0) System.exit(1);
    }
}
