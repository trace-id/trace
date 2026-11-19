# Trace (.NET)

> **Status.** Builds and passes its tests in CI (.NET 8): signature and sealed-result checks run against the shared test vectors, and the ASP.NET Core guard is exercised with a test server. It has not yet been used in a production app, so start the guard in shadow mode.

Server SDK: verify events, webhooks and sealed results, label events for the fraud score, and guard ASP.NET Core routes. .NET 8, no third-party dependencies.

```sh
dotnet add package TraceDevice
dotnet add package TraceDevice.AspNetCore   # the middleware and endpoint filter
```

```csharp
using TraceDevice;

var client = new TraceClient(Environment.GetEnvironmentVariable("TRACE_SECRET_KEY")!, "https://id.example.com");
try
{
    var ev = await client.GetEventAsync(eventId);
    if (ev.SuspectScore >= 60 || ev.Detected("multiAccount")) { /* ... */ }
}
catch (VerifyException e)
{
    // e.Code: timeout, not_found, expired, unauthorized, ...; decide whether to fail open or closed
}

// Fraud score: label outcomes per fraud type (a chargeback, or a review that cleared the user)
await client.LabelEventAsync(eventId, "payment", fraud: true);
await client.UnlabelEventAsync(eventId, "payment");

// Webhooks: pass the raw body exactly as received
var payload = TraceWebhooks.Verify(rawBodyBytes, Request.Headers["X-Signature"], webhookSecret);

// Sealed results (SEALED_RESULTS_KEY on the server), no API call
var sealedEvent = TraceSealed.Unseal(sealedResult, sealedKey);
```

## ASP.NET Core guard

Reads the event id from the `X-Trace-Event-Id` header, a JSON body or a form body, verifies it, and stores the event on the request (`context.GetTraceEvent()`). The body stays readable. `TRACE_SECRET_KEY` and `TRACE_ENDPOINT` are read from the environment.

```csharp
using TraceDevice;
using TraceDevice.AspNetCore;

// Middleware: guard POST/PUT/PATCH/DELETE under /api
app.UseTraceGuard(new TraceGuardOptions { RejectScore = 80, FailOpen = true },
                  ctx => ctx.Request.Path.StartsWithSegments("/api"));

// Or one minimal-API endpoint
app.MapPost("/signup", (HttpContext ctx) => Results.Ok(ctx.GetTraceEvent()?.VisitorId))
   .RequireTrace(new TraceGuardOptions { RejectScore = 80 });
```

Answers: 400 missing or invalid event, 403 rejected, 503 Trace unreachable (`FailOpen = true` lets it through), 500 bad key or missing configuration (never fails open).

Tests: `dotnet run --project sdks/dotnet/TraceDevice.Tests` (they read `../test-vectors/vectors.json`).
