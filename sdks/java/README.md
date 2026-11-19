# Trace (Java)

Server SDK: verify events, webhooks and sealed results, and label events for the fraud score. Java 11+, no dependencies (it includes a small JSON parser;
results are `Map<String, Object>`, numbers are `Double`).

```xml
<dependency>
  <groupId>io.github.trace-id</groupId>
  <artifactId>trace</artifactId>
  <version>0.1.0</version>
</dependency>
```

```java
Trace client = new Trace(System.getenv("TRACE_SECRET_KEY"), "https://id.example.com");
try {
    Map<String, Object> event = client.getEvent(eventId);
    double score = (Double) event.get("suspectScore");
} catch (Trace.VerifyException e) {
    // e.code: timeout, not_found, expired, unauthorized, ...
}

// Fraud score: label outcomes per fraud type (a chargeback, or a review that cleared the user)
client.labelEvent(eventId, "payment", true);
client.unlabelEvent(eventId, "payment");

Map<String, Object> payload = Trace.verifyWebhook(rawBody, request.getHeader("X-Signature"), webhookSecret);
Map<String, Object> sealed = Trace.unsealEventResult(sealedResult, List.of(sealedKey));
```

Tests: `javac -d out src/main/java/dev/trace/*.java src/test/java/dev/trace/*.java && java -cp out dev.trace.TraceTest`.
