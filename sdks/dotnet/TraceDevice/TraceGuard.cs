namespace TraceDevice;

/// <summary>Options for <see cref="TraceGuard"/>. Every property is optional.</summary>
public sealed class TraceGuardOptions
{
    /// <summary>Default: the TRACE_SECRET_KEY environment variable.</summary>
    public string? SecretKey { get; set; }
    /// <summary>Default: the TRACE_ENDPOINT environment variable.</summary>
    public string? Endpoint { get; set; }
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(2);
    /// <summary>Header that carries the event id. Default X-Trace-Event-Id.</summary>
    public string Header { get; set; } = "X-Trace-Event-Id";
    /// <summary>JSON or form field that carries the event id. Default eventId.</summary>
    public string BodyField { get; set; } = "eventId";
    /// <summary>Reject requests with no event id (400). Default true.</summary>
    public bool Required { get; set; } = true;
    /// <summary>When Trace is unreachable, let the request through with a null event instead of answering 503. A wrong key
    /// or missing configuration never fails open.</summary>
    public bool FailOpen { get; set; }
    /// <summary>Answer 403 when the suspect score is at or above this. Null disables.</summary>
    public double? RejectScore { get; set; }
    /// <summary>Answer 403 when this returns true. Runs only on a verified event.</summary>
    public Func<TraceEvent, bool>? Reject { get; set; }
    /// <summary>Replaces the Trace client (tests, custom transport).</summary>
    public TraceClient? Client { get; set; }
}

/// <summary>The result of one check. When <see cref="Ok"/> is false, answer with <see cref="Status"/> and
/// <see cref="Body"/>.</summary>
public sealed record GuardOutcome(bool Ok, TraceEvent? Event, int Status, string Code, string Message)
{
    public object Body => new { error = new { code = Code, message = Message } };
}

/// <summary>Framework-neutral guard: verifies the event id a request carries with your secret key, then applies your
/// rules. 400 missing or invalid event, 403 rejected, 503 Trace unreachable, 500 bad key or missing configuration.</summary>
public sealed class TraceGuard
{
    private static readonly HashSet<string> Transient = new() { "timeout", "network", "server_error", "rate_limited", "limit_reached", "invalid_response" };
    private readonly TraceGuardOptions _options;

    public TraceGuard(TraceGuardOptions? options = null) => _options = options ?? new TraceGuardOptions();

    public TraceGuardOptions Options => _options;

    public async Task<GuardOutcome> CheckAsync(string? eventId, CancellationToken cancellationToken = default)
    {
        var id = eventId?.Trim();
        if (string.IsNullOrEmpty(id))
            return _options.Required ? Fail(400, "event_required", "Missing Trace event id") : Pass(null);

        var client = _options.Client;
        if (client is null)
        {
            var key = _options.SecretKey ?? Environment.GetEnvironmentVariable("TRACE_SECRET_KEY");
            var endpoint = _options.Endpoint ?? Environment.GetEnvironmentVariable("TRACE_ENDPOINT");
            if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(endpoint))
                return Fail(500, "trace_misconfigured", "Set SecretKey and Endpoint (or TRACE_SECRET_KEY and TRACE_ENDPOINT)");
            try { client = new TraceClient(key, endpoint, _options.Timeout); }
            catch (VerifyException) { return Fail(500, "trace_misconfigured", "Trace rejected the secret key"); }
        }

        TraceEvent ev;
        try
        {
            ev = await client.GetEventAsync(id, cancellationToken).ConfigureAwait(false);
        }
        catch (VerifyException e)
        {
            if (e.Code == "unauthorized") return Fail(500, "trace_misconfigured", "Trace rejected the secret key");
            if (Transient.Contains(e.Code))
                return _options.FailOpen ? Pass(null) : Fail(503, "trace_unavailable", "Trace could not verify the event");
            return Fail(400, "event_invalid", "The Trace event id is invalid or expired");
        }

        if ((_options.RejectScore is { } limit && ev.SuspectScore >= limit) || (_options.Reject?.Invoke(ev) ?? false))
            return Fail(403, "trace_rejected", "Request rejected");
        return Pass(ev);
    }

    private static GuardOutcome Pass(TraceEvent? ev) => new(true, ev, 200, "", "");
    private static GuardOutcome Fail(int status, string code, string message) => new(false, null, status, code, message);
}
