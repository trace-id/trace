<?php

declare(strict_types=1);

namespace Trace\Laravel;

use Closure;
use Trace\Guard;

/**
 * Laravel route middleware. Reads the event id from the `X-Trace-Event-Id` header or the `eventId` input (JSON or form),
 * verifies it, and puts the verified event on `$request->attributes->get('trace')` (null only with fail_open).
 *
 *     // bootstrap/app.php (Laravel 11+):  $middleware->alias(['trace' => \Trace\Laravel\TraceMiddleware::class]);
 *     Route::post('/signup', SignupController::class)->middleware('trace:reject_score=80,fail_open');
 *
 * Options: `reject_score=N` (403 at or above N), `fail_open`, `optional` (no event id is allowed), `timeout=SECONDS`.
 * Keys come from TRACE_SECRET_KEY and TRACE_ENDPOINT, or config('services.trace.secret') and config('services.trace.endpoint').
 * Laravel is not a dependency of this package; the request and response are used through their public methods.
 */
final class TraceMiddleware
{
    public function handle(object $request, Closure $next, string ...$options): mixed
    {
        $opts = self::parse($options);
        $guard = new Guard(
            secretKey: self::config('secret'),
            endpoint: self::config('endpoint'),
            timeout: isset($opts['timeout']) ? (float) $opts['timeout'] : 2.0,
            required: !isset($opts['optional']),
            failOpen: isset($opts['fail_open']),
            rejectScore: isset($opts['reject_score']) ? (int) $opts['reject_score'] : null,
        );

        $id = $request->header('X-Trace-Event-Id') ?: $request->input('eventId');
        $out = $guard->check(is_string($id) ? $id : null);
        if (!$out['ok']) {
            $class = '\Illuminate\Http\JsonResponse';
            return new $class(['error' => ['code' => $out['code'], 'message' => $out['message']]], $out['status']);
        }
        $request->attributes->set('trace', $out['event']);
        return $next($request);
    }

    /** @param string[] $options @return array<string, string> */
    private static function parse(array $options): array
    {
        $out = [];
        foreach ($options as $o) {
            [$k, $v] = array_pad(explode('=', $o, 2), 2, '1');
            $out[trim($k)] = trim($v);
        }
        return $out;
    }

    private static function config(string $key): ?string
    {
        if (!function_exists('config')) {
            return null;
        }
        $v = config("services.trace.{$key}");
        return is_string($v) && $v !== '' ? $v : null;
    }
}
