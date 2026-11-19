using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace TraceDevice.AspNetCore;

/// <summary>Where the verified event is stored on the request: <c>HttpContext.Items["trace.event"]</c>.</summary>
public static class TraceHttpContextExtensions
{
    public const string ItemKey = "trace.event";

    /// <summary>The server-verified event, or null (no event id was required, or FailOpen let the request through).</summary>
    public static TraceEvent? GetTraceEvent(this HttpContext context) => context.Items[ItemKey] as TraceEvent;
}

public static class TraceGuardExtensions
{
    private const int MaxBody = 1 << 20;

    /// <summary>Middleware that guards the requests matching <paramref name="shouldGuard"/> (default: POST, PUT, PATCH and
    /// DELETE). The event id comes from the X-Trace-Event-Id header, a JSON body or a form body, and the body stays readable
    /// afterwards.
    /// <code>app.UseTraceGuard(new TraceGuardOptions { RejectScore = 80, FailOpen = true }, ctx => ctx.Request.Path.StartsWithSegments("/api"));</code></summary>
    public static IApplicationBuilder UseTraceGuard(this IApplicationBuilder app, TraceGuardOptions? options = null, Func<HttpContext, bool>? shouldGuard = null)
    {
        var guard = new TraceGuard(options);
        shouldGuard ??= ctx => HttpMethods.IsPost(ctx.Request.Method) || HttpMethods.IsPut(ctx.Request.Method)
                               || HttpMethods.IsPatch(ctx.Request.Method) || HttpMethods.IsDelete(ctx.Request.Method);
        return app.Use(async (context, next) =>
        {
            if (!shouldGuard(context)) { await next(context); return; }
            var outcome = await CheckAsync(guard, context);
            if (!outcome.Ok)
            {
                context.Response.StatusCode = outcome.Status;
                await context.Response.WriteAsJsonAsync(outcome.Body);
                return;
            }
            context.Items[TraceHttpContextExtensions.ItemKey] = outcome.Event;
            await next(context);
        });
    }

    /// <summary>Endpoint filter for minimal APIs.
    /// <code>app.MapPost("/signup", handler).RequireTrace(new TraceGuardOptions { RejectScore = 80 });</code></summary>
    public static RouteHandlerBuilder RequireTrace(this RouteHandlerBuilder builder, TraceGuardOptions? options = null)
    {
        var guard = new TraceGuard(options);
        return builder.AddEndpointFilter(async (invocation, next) =>
        {
            var context = invocation.HttpContext;
            var outcome = await CheckAsync(guard, context);
            if (!outcome.Ok) return Results.Json(outcome.Body, statusCode: outcome.Status);
            context.Items[TraceHttpContextExtensions.ItemKey] = outcome.Event;
            return await next(invocation);
        });
    }

    private static async Task<GuardOutcome> CheckAsync(TraceGuard guard, HttpContext context)
    {
        var o = guard.Options;
        var id = context.Request.Headers[o.Header].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(id)) id = await BodyEventIdAsync(context.Request, o.BodyField);
        return await guard.CheckAsync(id, context.RequestAborted);
    }

    private static async Task<string?> BodyEventIdAsync(HttpRequest request, string field)
    {
        var type = request.ContentType ?? "";
        var json = type.Contains("json", StringComparison.OrdinalIgnoreCase);
        var form = type.Contains("application/x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase)
                   || type.Contains("multipart/form-data", StringComparison.OrdinalIgnoreCase);
        if (!json && !form) return null;
        if (request.ContentLength is > MaxBody) return null;

        request.EnableBuffering(MaxBody);
        try
        {
            if (form)
            {
                var data = await request.ReadFormAsync();
                return data.TryGetValue(field, out var v) ? v.ToString() : null;
            }
            using var doc = await JsonDocument.ParseAsync(request.Body);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                   && doc.RootElement.TryGetProperty(field, out var el) && el.ValueKind == JsonValueKind.String
                ? el.GetString()
                : null;
        }
        catch (Exception e) when (e is JsonException or InvalidDataException or IOException or BadHttpRequestException)
        {
            return null;
        }
        finally
        {
            if (request.Body.CanSeek) request.Body.Position = 0;
        }
    }
}
