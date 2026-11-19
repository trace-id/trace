// Dependency-free test runner: dotnet run --project sdks/dotnet/TraceDevice.Tests
// Webhook and sealed-result checks read the shared vectors (sdks/test-vectors/vectors.json).
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using TraceDevice;
using TraceDevice.AspNetCore;

var passed = 0;
var failures = 0;
void Check(bool ok, string name)
{
    if (ok) passed++;
    else { failures++; Console.Error.WriteLine($"FAIL: {name}"); }
}
string CodeOf(Action fn)
{
    try { fn(); return "ok"; }
    catch (VerifyException e) { return e.Code; }
    catch (WebhookException e) { return e.Code; }
    catch (SealedException e) { return e.Code; }
}
async Task<string> CodeOfAsync(Func<Task> fn)
{
    try { await fn(); return "ok"; }
    catch (VerifyException e) { return e.Code; }
}

var dir = AppContext.BaseDirectory;
string vectorsPath = "";
for (var d = new DirectoryInfo(dir); d is not null; d = d.Parent)
{
    var candidate = Path.Combine(d.FullName, "sdks", "test-vectors", "vectors.json");
    var sibling = Path.Combine(d.FullName, "test-vectors", "vectors.json");
    if (File.Exists(candidate)) { vectorsPath = candidate; break; }
    if (File.Exists(sibling)) { vectorsPath = sibling; break; }
}
using var vectorsDoc = JsonDocument.Parse(File.ReadAllText(vectorsPath));
var v = vectorsDoc.RootElement;
var eventId = v.GetProperty("eventId").GetProperty("valid").GetString()!;
var w = v.GetProperty("webhook");
var webhookBody = w.GetProperty("body").GetString()!;
var eventJson = JsonDocument.Parse(webhookBody).RootElement.GetProperty("data").GetRawText();

// ---- Webhooks
var secret = w.GetProperty("secret").GetString()!;
var sig = w.GetProperty("signature").GetString()!;
var acceptedAt = DateTimeOffset.FromUnixTimeSeconds(w.GetProperty("nowAccepted").GetInt64());
var lateAt = DateTimeOffset.FromUnixTimeSeconds(w.GetProperty("nowTooLate").GetInt64());
var payload = TraceWebhooks.Verify(webhookBody, sig, secret, now: acceptedAt);
Check(payload.Id == "wh_1" && payload.Event()?.SuspectScore == 75, "webhook valid");
Check(CodeOf(() => TraceWebhooks.Verify(webhookBody, null, secret, now: acceptedAt)) == "missing_signature", "webhook missing");
Check(CodeOf(() => TraceWebhooks.Verify(webhookBody, "garbage", secret, now: acceptedAt)) == "malformed_signature", "webhook malformed");
Check(CodeOf(() => TraceWebhooks.Verify(webhookBody, sig, secret, now: lateAt)) == "timestamp_out_of_range", "webhook stale");
Check(CodeOf(() => TraceWebhooks.Verify(webhookBody, w.GetProperty("badSignature").GetString(), secret, now: acceptedAt)) == "invalid_signature", "webhook bad mac");

// ---- Sealed results
var s = v.GetProperty("sealed");
var key = s.GetProperty("key").GetString()!;
var unsealed = TraceSealed.Unseal(s.GetProperty("valid").GetString()!, key);
Check(unsealed.EventId == s.GetProperty("expect").GetProperty("eventId").GetString() && unsealed.SuspectScore == 75, "sealed valid");
Check(CodeOf(() => TraceSealed.Unseal(s.GetProperty("tampered").GetString()!, key)) == "tampered", "sealed tampered");
Check(CodeOf(() => TraceSealed.Unseal(s.GetProperty("expired").GetString()!, key)) == "expired", "sealed expired");
Check(CodeOf(() => TraceSealed.Unseal(s.GetProperty("valid").GetString()!, "short")) == "invalid_key", "sealed bad key");
Check(CodeOf(() => TraceSealed.Unseal(s.GetProperty("expired").GetString()!, key, checkExpiry: false)) == "ok", "sealed expired without check");
const string otherKey = "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=";
Check(CodeOf(() => TraceSealed.Unseal(s.GetProperty("valid").GetString()!, otherKey, new[] { key })) == "ok", "sealed rotation");

// ---- A listener standing in for the Trace API
var apiPort = 18651;
var apiUrl = $"http://127.0.0.1:{apiPort}";
using var listener = new HttpListener();
listener.Prefixes.Add(apiUrl + "/");
listener.Start();
var serving = Task.Run(async () =>
{
    while (listener.IsListening)
    {
        HttpListenerContext c;
        try { c = await listener.GetContextAsync(); } catch { break; }
        var path = c.Request.Url!.AbsolutePath;
        int status;
        string? body;
        if (c.Request.Headers["Authorization"] != "Bearer sk_test")
            (status, body) = (401, """{"error":{"code":"unauthorized","message":"bad key"}}""");
        else if (c.Request.HttpMethod == "GET" && path.EndsWith(eventId))
            (status, body) = (200, eventJson);
        else if (c.Request.HttpMethod == "PUT")
        {
            var label = path.Split('/').Last();
            using var reader = new StreamReader(c.Request.InputStream);
            var fraud = JsonDocument.Parse(await reader.ReadToEndAsync()).RootElement.GetProperty("fraud").GetBoolean();
            (status, body) = label == "full"
                ? (409, """{"error":{"code":"limit_reached","message":"too many types"}}""")
                : (200, JsonSerializer.Serialize(new { eventId = path.Split('/')[3], label, fraud }));
        }
        else if (c.Request.HttpMethod == "DELETE" && path.EndsWith("/labels/payment"))
            (status, body) = (204, null);
        else
            (status, body) = (404, """{"error":{"code":"not_found","message":"Event not found"}}""");
        c.Response.StatusCode = status;
        if (body is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            c.Response.ContentType = "application/json";
            await c.Response.OutputStream.WriteAsync(bytes);
        }
        c.Response.Close();
    }
});

// ---- Client
var client = new TraceClient("sk_test", apiUrl);
var ev = await client.GetEventAsync(eventId);
Check(ev.SuspectScore == 75 && ev.Detected("bot") && ev.Reasons.Count == 2, "GetEventAsync");
Check(await CodeOfAsync(() => client.GetEventAsync("nope")) == "invalid_event_id", "bad id");
Check(await CodeOfAsync(() => client.GetEventAsync("01a1dcf6-53b8-7c68-bd1d-000000000000")) == "not_found", "404");
Check(await CodeOfAsync(() => new TraceClient("sk_wrong", apiUrl).GetEventAsync(eventId)) == "unauthorized", "401");
Check(CodeOf(() => _ = new TraceClient("pk_public", apiUrl)) == "unauthorized", "public key refused");
await client.LabelEventAsync(eventId, "payment", true);
Check(true, "label");
Check(await CodeOfAsync(() => client.LabelEventAsync(eventId, "Payment", true)) == "invalid_label", "bad label");
Check(await CodeOfAsync(() => client.LabelEventAsync(eventId, "full", true)) == "limit_reached", "409");
await client.UnlabelEventAsync(eventId, "payment");
Check(await CodeOfAsync(() => client.UnlabelEventAsync(eventId, "promo")) == "not_found", "unlabel 404");
var slow = new TraceClient("sk_test", "http://10.255.255.1", TimeSpan.FromMilliseconds(300));
Check(await CodeOfAsync(() => slow.GetEventAsync(eventId)) is "timeout" or "network", "unreachable");

// ---- Guard
TraceGuard G(Action<TraceGuardOptions>? tweak = null)
{
    var o = new TraceGuardOptions { SecretKey = "sk_test", Endpoint = apiUrl };
    tweak?.Invoke(o);
    return new TraceGuard(o);
}
Check((await G().CheckAsync(eventId)).Ok, "guard verifies");
var missing = await G().CheckAsync(null);
Check(!missing.Ok && missing.Status == 400 && missing.Code == "event_required", "guard missing id");
Check((await G(o => o.Required = false).CheckAsync("")).Ok, "guard optional");
Check((await G(o => o.RejectScore = 75).CheckAsync(eventId)).Status == 403, "guard reject score at threshold");
Check((await G(o => o.RejectScore = 76).CheckAsync(eventId)).Ok, "guard reject score below");
Check((await G(o => o.Reject = e => e.Detected("bot")).CheckAsync(eventId)).Status == 403, "guard reject callback");
Check((await G().CheckAsync("01a1dcf6-53b8-7c68-bd1d-000000000000")).Status == 400, "guard unknown event");
Check((await G(o => { o.SecretKey = "sk_wrong"; o.FailOpen = true; }).CheckAsync(eventId)).Status == 500, "guard bad key never fails open");
Check((await new TraceGuard(new TraceGuardOptions { SecretKey = "", Endpoint = "" }).CheckAsync(eventId)).Status == 500, "guard missing config");
var down = await G(o => { o.Endpoint = "http://127.0.0.1:1"; o.Timeout = TimeSpan.FromMilliseconds(500); }).CheckAsync(eventId);
Check(down.Status == 503, "guard unreachable fails closed");
var open = await G(o => { o.Endpoint = "http://127.0.0.1:1"; o.Timeout = TimeSpan.FromMilliseconds(500); o.FailOpen = true; }).CheckAsync(eventId);
Check(open.Ok && open.Event is null, "guard fail open");

// ---- ASP.NET Core middleware and endpoint filter
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:18652");
builder.Logging.ClearProviders();
var app = builder.Build();
app.UseTraceGuard(new TraceGuardOptions { SecretKey = "sk_test", Endpoint = apiUrl }, ctx => ctx.Request.Path.StartsWithSegments("/guarded"));
app.MapPost("/guarded/signup", async (HttpContext ctx) =>
{
    using var reader = new StreamReader(ctx.Request.Body);
    var raw = await reader.ReadToEndAsync();
    return Results.Json(new { visitor = ctx.GetTraceEvent()?.VisitorId, raw });
});
app.MapPost("/open", () => Results.Ok("open"));
app.MapPost("/filtered", (HttpContext ctx) => Results.Ok(ctx.GetTraceEvent()?.VisitorId))
   .RequireTrace(new TraceGuardOptions { SecretKey = "sk_test", Endpoint = apiUrl, RejectScore = 70 });
await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:18652") };

var asJson = await http.PostAsJsonAsync("/guarded/signup", new { eventId, email = "a@b.test" });
Check(asJson.StatusCode == HttpStatusCode.OK, "middleware json body");
Check((await asJson.Content.ReadAsStringAsync()).Contains("a@b.test"), "middleware leaves the body readable");
var withHeader = new HttpRequestMessage(HttpMethod.Post, "/guarded/signup") { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
withHeader.Headers.Add("X-Trace-Event-Id", eventId);
Check((await http.SendAsync(withHeader)).StatusCode == HttpStatusCode.OK, "middleware header");
var asForm = await http.PostAsync("/guarded/signup", new FormUrlEncodedContent(new Dictionary<string, string> { ["eventId"] = eventId, ["email"] = "a@b.test" }));
Check(asForm.StatusCode == HttpStatusCode.OK, "middleware form body");
Check((await http.PostAsJsonAsync("/guarded/signup", new { email = "a@b.test" })).StatusCode == HttpStatusCode.BadRequest, "middleware missing id");
Check((await http.PostAsync("/open", null)).StatusCode == HttpStatusCode.OK, "unguarded path passes");
var filtered = await http.PostAsJsonAsync("/filtered", new { eventId });
Check(filtered.StatusCode == HttpStatusCode.Forbidden, "endpoint filter rejects score 75 at 70");

await app.StopAsync();
listener.Stop();
await serving;
Console.WriteLine($"{passed} passed, {failures} failed");
return failures == 0 ? 0 : 1;
