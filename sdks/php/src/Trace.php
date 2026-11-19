<?php

declare(strict_types=1);

namespace Trace;

/** code: invalid_event_id, invalid_label, timeout, network, unauthorized, not_found, expired, rate_limited, limit_reached, server_error, invalid_response */
final class VerifyError extends \RuntimeException
{
    public function __construct(public readonly string $errorCode, string $message, public readonly ?int $status = null)
    {
        parent::__construct($message);
    }
}

/** code: missing_signature, malformed_signature, timestamp_out_of_range, invalid_signature, invalid_payload */
final class WebhookVerificationError extends \RuntimeException
{
    public function __construct(public readonly string $errorCode, string $message)
    {
        parent::__construct($message);
    }
}

/** code: invalid_key, malformed, unsupported_version, tampered, expired */
final class SealedResultError extends \RuntimeException
{
    public function __construct(public readonly string $errorCode, string $message)
    {
        parent::__construct($message);
    }
}

/**
 * Server SDK: verify events, webhooks and sealed results. Only the verified event should drive decisions; whatever the
 * browser sends you can be forged.
 */
final class Client
{
    private const LABEL = '/^[a-z][a-z0-9_]{0,31}$/';
    private const EVENT_ID = '/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/';

    private string $endpoint;

    public function __construct(private string $secretKey, string $endpoint, private float $timeout = 2.0)
    {
        if (!str_starts_with($secretKey, 'sk_')) {
            throw new VerifyError('unauthorized', 'secretKey must be a secret key (sk_...)');
        }
        $this->endpoint = rtrim($endpoint, '/');
    }

    /** @return array<string, mixed> the event, as GET /v1/events/:eventId returns it */
    public function getEvent(string $eventId): array
    {
        self::checkEventId($eventId);
        [$status, $json] = $this->request('GET', "/v1/events/{$eventId}");
        if (!is_array($json) || !is_string($json['eventId'] ?? null) || !is_string($json['visitorId'] ?? null)
            || !is_numeric($json['suspectScore'] ?? null) || !is_array($json['reasons'] ?? null) || !is_array($json['signals'] ?? null)) {
            throw new VerifyError('invalid_response', 'Unexpected response shape', $status);
        }
        return $json;
    }

    /**
     * Records your verdict on an event for one fraud type (e.g. "payment" after a chargeback, or false after a review
     * cleared it). Trace trains a model per type from these labels and adds fraudScores to new events. Labelling again
     * replaces the verdict.
     *
     * @return array{eventId: string, label: string, fraud: bool}
     */
    public function labelEvent(string $eventId, string $label, bool $fraud): array
    {
        self::checkEventId($eventId);
        self::checkLabel($label);
        [$status, $json] = $this->request('PUT', "/v1/events/{$eventId}/labels/{$label}", ['fraud' => $fraud]);
        if (!is_array($json) || ($json['eventId'] ?? null) !== $eventId || ($json['label'] ?? null) !== $label || !is_bool($json['fraud'] ?? null)) {
            throw new VerifyError('invalid_response', 'Unexpected response shape', $status);
        }
        return $json;
    }

    /** Removes a label; throws not_found when the event has no label of that type. */
    public function unlabelEvent(string $eventId, string $label): void
    {
        self::checkEventId($eventId);
        self::checkLabel($label);
        $this->request('DELETE', "/v1/events/{$eventId}/labels/{$label}");
    }

    private static function checkEventId(string $eventId): void
    {
        if (preg_match(self::EVENT_ID, $eventId) !== 1) {
            throw new VerifyError('invalid_event_id', 'eventId is not a valid event id');
        }
    }

    private static function checkLabel(string $label): void
    {
        if (preg_match(self::LABEL, $label) !== 1) {
            throw new VerifyError('invalid_label', 'label must match ^[a-z][a-z0-9_]{0,31}$');
        }
    }

    /** @return array{0: int, 1: mixed} status and decoded body (null when empty) */
    private function request(string $method, string $path, ?array $body = null): array
    {
        $header = "Authorization: Bearer {$this->secretKey}\r\nAccept: application/json\r\n";
        $http = ['method' => $method, 'timeout' => $this->timeout, 'ignore_errors' => true, 'follow_location' => 0];
        if ($body !== null) {
            $header .= "Content-Type: application/json\r\n";
            $http['content'] = json_encode($body);
        }
        $http['header'] = $header;
        $started = microtime(true);
        $raw = @file_get_contents("{$this->endpoint}{$path}", false, stream_context_create(['http' => $http]));
        if ($raw === false) {
            $timedOut = microtime(true) - $started >= $this->timeout - 0.05;
            throw new VerifyError($timedOut ? 'timeout' : 'network', $timedOut ? 'Verification timed out' : 'Network error');
        }
        $status = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                $status = (int) $m[1];
            }
        }
        $json = $raw === '' ? null : json_decode($raw, true);
        if ($status < 200 || $status >= 300) {
            $error = is_array($json) && is_array($json['error'] ?? null) ? $json['error'] : [];
            $serverCode = is_string($error['code'] ?? null) ? $error['code'] : null;
            throw new VerifyError(self::codeFor($status, $serverCode), is_string($error['message'] ?? null) ? $error['message'] : "HTTP {$status}", $status);
        }
        return [$status, $json];
    }

    private static function codeFor(int $status, ?string $serverCode): string
    {
        return match (true) {
            $status === 401, $status === 403 => 'unauthorized',
            $status === 404 => 'not_found',
            $status === 410, $serverCode === 'event_expired' => 'expired',
            $status === 429 => 'rate_limited',
            $status === 400 && $serverCode === 'invalid_label' => 'invalid_label',
            $status === 400 => 'invalid_event_id',
            $status === 409 => 'limit_reached',
            default => 'server_error',
        };
    }

    /**
     * Verifies the X-Signature header (t=<unix>,v1=<hex hmac>) against the raw body (php://input, unmodified) and
     * returns the payload. Deliveries are at-least-once: dedupe on payload id.
     *
     * @return array<string, mixed>
     */
    public static function verifyWebhook(string $body, ?string $signature, string $secret, int $toleranceSec = 300, ?int $now = null): array
    {
        if ($signature === null || $signature === '') {
            throw new WebhookVerificationError('missing_signature', 'Missing X-Signature header');
        }
        $timestamp = null;
        $macs = [];
        foreach (explode(',', $signature) as $part) {
            [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
            if ($k === 't' && preg_match('/^\d{1,12}$/', $v) === 1) {
                $timestamp = (int) $v;
            } elseif ($k === 'v1' && preg_match('/^[0-9a-f]{64}$/', $v) === 1) {
                $macs[] = $v;
            }
        }
        if ($timestamp === null || $macs === []) {
            throw new WebhookVerificationError('malformed_signature', 'X-Signature is malformed');
        }
        if (abs(($now ?? time()) - $timestamp) > $toleranceSec) {
            throw new WebhookVerificationError('timestamp_out_of_range', 'Webhook timestamp is outside the tolerance');
        }
        $expected = hash_hmac('sha256', "{$timestamp}.{$body}", $secret);
        $valid = false;
        foreach ($macs as $mac) {
            $valid = hash_equals($expected, $mac) || $valid;
        }
        if (!$valid) {
            throw new WebhookVerificationError('invalid_signature', 'Webhook signature does not match');
        }
        $payload = json_decode($body, true);
        if (!is_array($payload) || !is_string($payload['id'] ?? null) || !is_string($payload['type'] ?? null) || !is_array($payload['data'] ?? null)) {
            throw new WebhookVerificationError('invalid_payload', 'Webhook body has an unexpected shape');
        }
        return $payload;
    }

    /**
     * Decrypts the sealedResult from an identify response with the server's SEALED_RESULTS_KEY (several keys during a
     * rotation). Authenticated, so it cannot be altered; still accept each eventId only once.
     *
     * @param string|list<string> $key
     * @return array<string, mixed>
     */
    public static function unsealEventResult(string $sealedResult, string|array $key, bool $checkExpiry = true, ?int $now = null): array
    {
        $keys = [];
        foreach ((array) $key as $k) {
            $bytes = base64_decode($k, true);
            if ($bytes === false || strlen($bytes) !== 32) {
                throw new SealedResultError('invalid_key', 'The key must be base64 of exactly 32 bytes');
            }
            $keys[] = $bytes;
        }
        $sealed = base64_decode(strtr($sealedResult, '-_', '+/') . str_repeat('=', (4 - strlen($sealedResult) % 4) % 4), true);
        if ($sealed === false || strlen($sealed) < 1 + 12 + 16 + 1) {
            throw new SealedResultError('malformed', 'Sealed result is too short or not base64url');
        }
        if (ord($sealed[0]) !== 1) {
            throw new SealedResultError('unsupported_version', 'Unsupported sealed result version ' . ord($sealed[0]));
        }
        $iv = substr($sealed, 1, 12);
        $tag = substr($sealed, -16);
        $body = substr($sealed, 13, -16);
        $plain = false;
        foreach ($keys as $k) {
            $plain = openssl_decrypt($body, 'aes-256-gcm', $k, OPENSSL_RAW_DATA, $iv, $tag, 'trace-sealed-v1');
            if ($plain !== false) {
                break;
            }
        }
        if ($plain === false) {
            throw new SealedResultError('tampered', 'Sealed result failed authentication (wrong key or altered)');
        }
        $json = @gzinflate($plain);
        $event = $json === false ? null : json_decode($json, true);
        if (!is_array($event)) {
            throw new SealedResultError('malformed', 'Sealed result content is not valid');
        }
        if ($checkExpiry) {
            $expires = strtotime((string) ($event['expiresAt'] ?? ''));
            if ($expires === false || $expires < ($now ?? time())) {
                throw new SealedResultError('expired', 'The event is past its verification window');
            }
        }
        return $event;
    }
}
