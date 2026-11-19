<?php

declare(strict_types=1);

namespace Trace;

/**
 * Framework-neutral guard: verifies the event id a request carries with your secret key, then lets your rules decide.
 * The Laravel middleware is a thin wrapper; use this directly in plain PHP, WordPress, Slim or Symfony.
 *
 *     $out = (new Guard(rejectScore: 80))->check($_SERVER['HTTP_X_TRACE_EVENT_ID'] ?? $body['eventId'] ?? null);
 *     if (!$out['ok']) { http_response_code($out['status']); echo json_encode(['error' => ['code' => $out['code'], 'message' => $out['message']]]); exit; }
 *     $event = $out['event']; // null only with failOpen or required: false
 *
 * Answers: 400 missing or invalid event, 403 rejected, 503 Trace unreachable, 500 bad key or missing configuration.
 * `failOpen` only covers "unreachable"; a wrong key never fails open.
 */
final class Guard
{
    private const TRANSIENT = ['timeout', 'network', 'server_error', 'rate_limited', 'limit_reached', 'invalid_response'];

    /**
     * @param ?callable(array<string, mixed>): bool $reject return true to answer 403; runs only on a verified event
     * @param ?int $rejectScore shortcut: answer 403 when suspectScore is at or above this
     */
    public function __construct(
        private ?string $secretKey = null,
        private ?string $endpoint = null,
        private float $timeout = 2.0,
        private bool $required = true,
        private bool $failOpen = false,
        private $reject = null,
        private ?int $rejectScore = null,
    ) {
    }

    /** @return array{ok: bool, event: ?array<string, mixed>, status: int, code: string, message: string} */
    public function check(?string $eventId): array
    {
        if ($eventId === null || trim($eventId) === '') {
            return $this->required
                ? self::fail(400, 'event_required', 'Missing Trace event id')
                : self::pass(null);
        }
        $key = $this->secretKey ?: self::env('TRACE_SECRET_KEY');
        $endpoint = $this->endpoint ?: self::env('TRACE_ENDPOINT');
        if (!$key || !$endpoint) {
            return self::fail(500, 'trace_misconfigured', 'Set secretKey and endpoint (or TRACE_SECRET_KEY and TRACE_ENDPOINT)');
        }
        try {
            $event = (new Client($key, $endpoint, $this->timeout))->getEvent(trim($eventId));
        } catch (VerifyError $e) {
            if (in_array($e->errorCode, self::TRANSIENT, true)) {
                return $this->failOpen ? self::pass(null) : self::fail(503, 'trace_unavailable', 'Trace could not verify the event');
            }
            if ($e->errorCode === 'unauthorized') {
                return self::fail(500, 'trace_misconfigured', 'Trace rejected the secret key');
            }
            return self::fail(400, 'event_invalid', 'The Trace event id is invalid or expired');
        }
        if (($this->rejectScore !== null && (float) $event['suspectScore'] >= $this->rejectScore)
            || ($this->reject !== null && ($this->reject)($event))) {
            return self::fail(403, 'trace_rejected', 'Request rejected');
        }
        return self::pass($event);
    }

    /** Environment lookup that works with and without putenv(): $_ENV, $_SERVER, then getenv(). */
    public static function env(string $name): ?string
    {
        $v = $_ENV[$name] ?? $_SERVER[$name] ?? getenv($name);
        return is_string($v) && $v !== '' ? $v : null;
    }

    private static function pass(?array $event): array
    {
        return ['ok' => true, 'event' => $event, 'status' => 200, 'code' => '', 'message' => ''];
    }

    private static function fail(int $status, string $code, string $message): array
    {
        return ['ok' => false, 'event' => null, 'status' => $status, 'code' => $code, 'message' => $message];
    }
}
