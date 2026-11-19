using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TraceDevice;

/// <summary>Returned for every failed call to the Trace server. <see cref="Code"/> is one of: invalid_event_id,
/// invalid_label, timeout, network, unauthorized, not_found, expired, rate_limited, limit_reached, server_error,
/// invalid_response.</summary>
public sealed class VerifyException : Exception
{
    public string Code { get; }
    public int? Status { get; }
    public TimeSpan? RetryAfter { get; }

    public VerifyException(string code, string message, int? status = null, TimeSpan? retryAfter = null) : base(message)
    {
        Code = code;
        Status = status;
        RetryAfter = retryAfter;
    }
}

/// <summary>One signal's contribution to the suspect score.</summary>
public sealed record Reason(string Signal, double Contribution);

/// <summary>One fraud signal's result.</summary>
public sealed record SignalResult(bool Detected);

/// <summary>A server-recorded identification event, as GET /v1/events/:eventId returns it.</summary>
public sealed class TraceEvent
{
    public string EventId { get; init; } = "";
    public string VisitorId { get; init; } = "";
    public string? DeviceId { get; init; }
    public double Confidence { get; init; }
    public double SuspectScore { get; init; }
    public IReadOnlyList<Reason> Reasons { get; init; } = Array.Empty<Reason>();
    public IReadOnlyDictionary<string, SignalResult> Signals { get; init; } = new Dictionary<string, SignalResult>();
    public string? ExpiresAt { get; init; }

    /// <summary>The full JSON body, for fields this class does not name (ip, botInfo, fraudScores, ...).</summary>
    public JsonElement Raw { get; init; }

    /// <summary>Whether the named signal fired.</summary>
    public bool Detected(string signal) => Signals.TryGetValue(signal, out var s) && s.Detected;

    internal static TraceEvent? Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        if (!root.TryGetProperty("eventId", out var id) || id.ValueKind != JsonValueKind.String) return null;
        if (!root.TryGetProperty("visitorId", out var visitor) || visitor.ValueKind != JsonValueKind.String) return null;
        if (!root.TryGetProperty("confidence", out var conf) || conf.ValueKind != JsonValueKind.Number) return null;
        if (!root.TryGetProperty("suspectScore", out var score) || score.ValueKind != JsonValueKind.Number) return null;
        if (!root.TryGetProperty("reasons", out var reasons) || reasons.ValueKind != JsonValueKind.Array) return null;
        if (!root.TryGetProperty("signals", out var signals) || signals.ValueKind != JsonValueKind.Object) return null;

        var reasonList = new List<Reason>();
        foreach (var r in reasons.EnumerateArray())
        {
            if (r.ValueKind != JsonValueKind.Object) continue;
            var name = r.TryGetProperty("signal", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString()! : "";
            var contribution = r.TryGetProperty("contribution", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetDouble() : 0;
            reasonList.Add(new Reason(name, contribution));
        }
        var signalMap = new Dictionary<string, SignalResult>();
        foreach (var p in signals.EnumerateObject())
        {
            var detected = p.Value.ValueKind == JsonValueKind.Object && p.Value.TryGetProperty("detected", out var d) && d.ValueKind == JsonValueKind.True;
            signalMap[p.Name] = new SignalResult(detected);
        }
        return new TraceEvent
        {
            EventId = id.GetString()!,
            VisitorId = visitor.GetString()!,
            DeviceId = root.TryGetProperty("deviceId", out var dev) && dev.ValueKind == JsonValueKind.String ? dev.GetString() : null,
            Confidence = conf.GetDouble(),
            SuspectScore = score.GetDouble(),
            Reasons = reasonList,
            Signals = signalMap,
            ExpiresAt = root.TryGetProperty("expiresAt", out var exp) && exp.ValueKind == JsonValueKind.String ? exp.GetString() : null,
            Raw = root.Clone(),
        };
    }
}

/// <summary>Fetches events with a secret key. Safe to share between threads.</summary>
public sealed class TraceClient
{
    private static readonly Regex EventIdPattern = new("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.Compiled);
    private static readonly Regex LabelPattern = new("^[a-z][a-z0-9_]{0,31}$", RegexOptions.Compiled);

    private readonly string _secretKey;
    private readonly string _endpoint;
    private readonly HttpClient _http;
    private readonly TimeSpan _timeout;

    /// <param name="secretKey">A secret key (sk_...). Keep it on your server.</param>
    /// <param name="endpoint">The Trace server, for example https://id.example.com.</param>
    /// <param name="timeout">Per-call timeout. Default 2 seconds. Decide yourself whether a timeout fails open or closed.</param>
    /// <param name="http">Your own HttpClient. The default one never follows redirects, so the key is never resent elsewhere;
    /// if you pass your own, turn AllowAutoRedirect off.</param>
    public TraceClient(string secretKey, string endpoint, TimeSpan? timeout = null, HttpClient? http = null)
    {
        if (!secretKey.StartsWith("sk_", StringComparison.Ordinal))
            throw new VerifyException("unauthorized", "secretKey must be a secret key (sk_...)");
        _secretKey = secretKey;
        _endpoint = endpoint.TrimEnd('/');
        _timeout = timeout ?? TimeSpan.FromSeconds(2);
        _http = http ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false });
    }

    /// <summary>The full, server-recorded event.</summary>
    public async Task<TraceEvent> GetEventAsync(string eventId, CancellationToken cancellationToken = default)
    {
        CheckEventId(eventId);
        var (status, body) = await SendAsync(HttpMethod.Get, $"/v1/events/{eventId}", null, cancellationToken).ConfigureAwait(false);
        var ev = body is { } json ? TraceEvent.Parse(json) : null;
        return ev ?? throw new VerifyException("invalid_response", "Unexpected response shape", status);
    }

    /// <summary>Records your verdict on an event for one fraud type. Labelling again replaces the verdict.</summary>
    public async Task LabelEventAsync(string eventId, string label, bool fraud, CancellationToken cancellationToken = default)
    {
        CheckEventId(eventId);
        CheckLabel(label);
        var payload = JsonSerializer.Serialize(new { fraud });
        var (status, body) = await SendAsync(HttpMethod.Put, $"/v1/events/{eventId}/labels/{label}", payload, cancellationToken).ConfigureAwait(false);
        var ok = body is { ValueKind: JsonValueKind.Object } b
            && b.TryGetProperty("eventId", out var e) && e.GetString() == eventId
            && b.TryGetProperty("label", out var l) && l.GetString() == label
            && b.TryGetProperty("fraud", out var f) && f.ValueKind is JsonValueKind.True or JsonValueKind.False;
        if (!ok) throw new VerifyException("invalid_response", "Unexpected response shape", status);
    }

    /// <summary>Removes a label. Throws not_found when the event has no label of that type.</summary>
    public async Task UnlabelEventAsync(string eventId, string label, CancellationToken cancellationToken = default)
    {
        CheckEventId(eventId);
        CheckLabel(label);
        await SendAsync(HttpMethod.Delete, $"/v1/events/{eventId}/labels/{label}", null, cancellationToken).ConfigureAwait(false);
    }

    private static void CheckEventId(string eventId)
    {
        if (!EventIdPattern.IsMatch(eventId ?? "")) throw new VerifyException("invalid_event_id", "eventId is not a valid event id");
    }

    private static void CheckLabel(string label)
    {
        if (!LabelPattern.IsMatch(label ?? "")) throw new VerifyException("invalid_label", "label must match ^[a-z][a-z0-9_]{0,31}$");
    }

    private static string CodeFor(int status, string? serverCode) => status switch
    {
        401 or 403 => "unauthorized",
        404 => "not_found",
        410 => "expired",
        429 => "rate_limited",
        400 => serverCode == "invalid_label" ? "invalid_label" : "invalid_event_id",
        409 => "limit_reached",
        _ => serverCode == "event_expired" ? "expired" : "server_error",
    };

    private async Task<(int Status, JsonElement? Body)> SendAsync(HttpMethod method, string path, string? json, CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(_timeout);
        using var request = new HttpRequestMessage(method, _endpoint + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _secretKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (json is not null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new VerifyException("timeout", "Verification timed out");
        }
        catch (HttpRequestException e)
        {
            throw new VerifyException("network", e.Message);
        }

        using (response)
        {
            var status = (int)response.StatusCode;
            JsonElement? parsed = null;
            try
            {
                var raw = await response.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
                if (raw.Length > 0) parsed = JsonDocument.Parse(raw).RootElement.Clone();
            }
            catch (JsonException) { }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new VerifyException("timeout", "Verification timed out");
            }

            if (status >= 300)
            {
                string? serverCode = null, serverMessage = null;
                if (parsed is { ValueKind: JsonValueKind.Object } p && p.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.Object)
                {
                    serverCode = err.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
                    serverMessage = err.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
                }
                TimeSpan? retry = response.Headers.RetryAfter?.Delta;
                throw new VerifyException(CodeFor(status, serverCode), serverMessage ?? $"HTTP {status}", status, retry);
            }
            return (status, parsed);
        }
    }
}
