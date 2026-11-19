using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TraceDevice;

/// <summary>Returned when a webhook delivery cannot be trusted. Code: missing_signature, malformed_signature,
/// timestamp_out_of_range, invalid_signature, invalid_payload.</summary>
public sealed class WebhookException : Exception
{
    public string Code { get; }
    public WebhookException(string code, string message) : base(message) => Code = code;
}

/// <summary>Returned when a sealed result cannot be opened. Code: invalid_key, malformed, unsupported_version, tampered,
/// expired.</summary>
public sealed class SealedException : Exception
{
    public string Code { get; }
    public SealedException(string code, string message) : base(message) => Code = code;
}

/// <summary>A verified webhook delivery. Deliveries are at least once: dedupe on <see cref="Id"/>.</summary>
public sealed record WebhookPayload(string Id, string Type, JsonElement Data)
{
    /// <summary>Data as an event, for event.* deliveries.</summary>
    public TraceEvent? Event() => TraceEvent.Parse(Data);
}

public static class TraceWebhooks
{
    private static readonly Regex Timestamp = new(@"^\d{1,12}$", RegexOptions.Compiled);
    private static readonly Regex Mac = new("^[0-9a-f]{64}$", RegexOptions.Compiled);

    /// <summary>Checks the X-Signature header (t=&lt;unix&gt;,v1=&lt;hex hmac&gt;) against the raw request body and returns the
    /// payload. Pass the body exactly as received, before any JSON parsing.</summary>
    public static WebhookPayload Verify(byte[] body, string? signature, string secret, TimeSpan? tolerance = null, DateTimeOffset? now = null)
    {
        if (string.IsNullOrEmpty(signature)) throw new WebhookException("missing_signature", "Missing X-Signature header");
        long? timestamp = null;
        var macs = new List<string>();
        foreach (var part in signature.Split(','))
        {
            var kv = part.Trim().Split('=', 2);
            if (kv.Length != 2) continue;
            if (kv[0] == "t" && Timestamp.IsMatch(kv[1])) timestamp = long.Parse(kv[1]);
            else if (kv[0] == "v1" && Mac.IsMatch(kv[1])) macs.Add(kv[1]);
        }
        if (timestamp is null || macs.Count == 0) throw new WebhookException("malformed_signature", "X-Signature is malformed");

        var current = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        if (Math.Abs(current - timestamp.Value) > (tolerance ?? TimeSpan.FromMinutes(5)).TotalSeconds)
            throw new WebhookException("timestamp_out_of_range", "Webhook timestamp is outside the tolerance");

        var signed = Encoding.ASCII.GetBytes($"{timestamp}.").Concat(body).ToArray();
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), signed);
        var valid = false;
        foreach (var mac in macs)
            if (CryptographicOperations.FixedTimeEquals(expected, Convert.FromHexString(mac))) valid = true;
        if (!valid) throw new WebhookException("invalid_signature", "Webhook signature does not match");

        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String
                && root.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String
                && root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
                return new WebhookPayload(id.GetString()!, type.GetString()!, data.Clone());
        }
        catch (JsonException) { }
        throw new WebhookException("invalid_payload", "Webhook body has an unexpected shape");
    }

    public static WebhookPayload Verify(string body, string? signature, string secret, TimeSpan? tolerance = null, DateTimeOffset? now = null)
        => Verify(Encoding.UTF8.GetBytes(body), signature, secret, tolerance, now);
}

public static class TraceSealed
{
    private static readonly byte[] Aad = Encoding.ASCII.GetBytes("trace-sealed-v1");

    /// <summary>Decrypts the sealedResult from an identify response with the base64 32-byte key (the server's
    /// SEALED_RESULTS_KEY). Pass older keys in <paramref name="rotationKeys"/> during a rotation. It is authenticated, so it
    /// cannot be altered; still accept each EventId only once to stop replays.</summary>
    public static TraceEvent Unseal(string sealedResult, string key, IEnumerable<string>? rotationKeys = null, bool checkExpiry = true, DateTimeOffset? now = null)
    {
        var keys = new List<byte[]>();
        foreach (var k in new[] { key }.Concat(rotationKeys ?? Array.Empty<string>()))
        {
            byte[] raw;
            try { raw = Convert.FromBase64String(k); } catch (FormatException) { raw = Array.Empty<byte>(); }
            if (raw.Length != 32) throw new SealedException("invalid_key", "The key must be base64 of exactly 32 bytes");
            keys.Add(raw);
        }

        byte[] data;
        try
        {
            var b64 = sealedResult.Replace('-', '+').Replace('_', '/');
            data = Convert.FromBase64String(b64.PadRight(b64.Length + (4 - b64.Length % 4) % 4, '='));
        }
        catch (FormatException) { throw new SealedException("malformed", "Sealed result is not base64url"); }

        if (data.Length < 1 + 12 + 16 + 1) throw new SealedException("malformed", "Sealed result is too short");
        if (data[0] != 1) throw new SealedException("unsupported_version", "Unsupported sealed result version");

        var iv = data.AsSpan(1, 12);
        var encrypted = data.AsSpan(13);
        var ciphertext = encrypted[..^16];
        var tag = encrypted[^16..];
        byte[]? plain = null;
        foreach (var k in keys)
        {
            try
            {
                using var aes = new AesGcm(k, 16);
                var output = new byte[ciphertext.Length];
                aes.Decrypt(iv, ciphertext, tag, output, Aad);
                plain = output;
                break;
            }
            catch (CryptographicException) { }
        }
        if (plain is null) throw new SealedException("tampered", "Sealed result failed authentication (wrong key or altered)");

        TraceEvent? ev;
        try
        {
            using var inflater = new DeflateStream(new MemoryStream(plain), CompressionMode.Decompress);
            using var json = new MemoryStream();
            inflater.CopyTo(json);
            using var doc = JsonDocument.Parse(json.ToArray());
            ev = TraceEvent.Parse(doc.RootElement);
        }
        catch (Exception e) when (e is InvalidDataException or JsonException) { ev = null; }
        if (ev is null) throw new SealedException("malformed", "Sealed result content is not valid");

        if (checkExpiry)
        {
            var ok = DateTimeOffset.TryParse(ev.ExpiresAt, null, System.Globalization.DateTimeStyles.AssumeUniversal, out var expires);
            if (!ok || expires < (now ?? DateTimeOffset.UtcNow)) throw new SealedException("expired", "The event is past its verification window");
        }
        return ev;
    }
}
