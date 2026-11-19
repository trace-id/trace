<?php

declare(strict_types=1);

// Dependency-free test runner: php tests/run.php
require __DIR__ . '/../src/Trace.php';
require __DIR__ . '/../src/Guard.php';
require __DIR__ . '/../src/Laravel/TraceMiddleware.php';

use Trace\Client;
use Trace\SealedResultError;
use Trace\VerifyError;
use Trace\WebhookVerificationError;

$v = json_decode((string) file_get_contents(__DIR__ . '/../../test-vectors/vectors.json'), true);
$failures = 0;
$passed = 0;

function check(bool $ok, string $name): void
{
    global $failures, $passed;
    if ($ok) {
        $passed++;
    } else {
        $failures++;
        fwrite(STDERR, "FAIL: {$name}\n");
    }
}

function code(callable $fn): string
{
    try {
        $fn();
    } catch (VerifyError | WebhookVerificationError | SealedResultError $e) {
        return $e->errorCode;
    }
    return 'ok';
}

// Webhooks
$w = $v['webhook'];
$p = Client::verifyWebhook($w['body'], $w['signature'], $w['secret'], 300, $w['nowAccepted']);
check($p['id'] === 'wh_1' && $p['data']['suspectScore'] === 75, 'webhook valid');
check(code(fn () => Client::verifyWebhook($w['body'], null, $w['secret'], 300, $w['nowAccepted'])) === 'missing_signature', 'webhook missing');
check(code(fn () => Client::verifyWebhook($w['body'], 'garbage', $w['secret'], 300, $w['nowAccepted'])) === 'malformed_signature', 'webhook malformed');
check(code(fn () => Client::verifyWebhook($w['body'], $w['signature'], $w['secret'], 300, $w['nowTooLate'])) === 'timestamp_out_of_range', 'webhook stale');
check(code(fn () => Client::verifyWebhook($w['body'], $w['badSignature'], $w['secret'], 300, $w['nowAccepted'])) === 'invalid_signature', 'webhook bad mac');

// Sealed results
$s = $v['sealed'];
$e = Client::unsealEventResult($s['valid'], $s['key']);
check($e['eventId'] === $s['expect']['eventId'] && $e['suspectScore'] === 75, 'sealed valid');
check(Client::unsealEventResult($s['valid'], [base64_encode(str_repeat("\0", 32)), $s['key']])['suspectScore'] === 75, 'sealed rotation');
check(code(fn () => Client::unsealEventResult($s['tampered'], $s['key'])) === 'tampered', 'sealed tampered');
check(code(fn () => Client::unsealEventResult($s['expired'], $s['key'])) === 'expired', 'sealed expired');
check(code(fn () => Client::unsealEventResult('abc', $s['key'])) === 'malformed', 'sealed malformed');
check(code(fn () => Client::unsealEventResult($s['valid'], 'short')) === 'invalid_key', 'sealed bad key');

// Event verification against a local PHP server
$port = 18000 + random_int(0, 999);
$router = __DIR__ . '/router.php';
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$port}", $router], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
usleep(600_000);
try {
    $endpoint = "http://127.0.0.1:{$port}";
    $event = (new Client('sk_test', $endpoint))->getEvent($v['eventId']['valid']);
    check($event['suspectScore'] === 75, 'getEvent');
    check(code(fn () => (new Client('sk_test', $endpoint))->getEvent('nope')) === 'invalid_event_id', 'getEvent bad id');
    check(code(fn () => (new Client('sk_wrong', $endpoint))->getEvent($v['eventId']['valid'])) === 'unauthorized', 'getEvent 401');
    check(code(fn () => (new Client('sk_test', $endpoint))->getEvent('01a1dcf6-53b8-7c68-bd1d-000000000000')) === 'not_found', 'getEvent 404');
    check(code(fn () => new Client('pk_public', $endpoint)) === 'unauthorized', 'public key refused');
    $c = new Client('sk_test', $endpoint);
    $valid = $v['eventId']['valid'];
    check($c->labelEvent($valid, 'payment', true) === ['eventId' => $valid, 'label' => 'payment', 'fraud' => true], 'labelEvent');
    check($c->labelEvent($valid, 'payment', false)['fraud'] === false, 'labelEvent legit');
    $c->unlabelEvent($valid, 'payment');
    check(true, 'unlabelEvent');
    check(code(fn () => $c->labelEvent($valid, 'Payment', true)) === 'invalid_label', 'labelEvent bad label');
    check(code(fn () => $c->labelEvent('nope', 'payment', true)) === 'invalid_event_id', 'labelEvent bad id');
    check(code(fn () => $c->labelEvent($valid, 'full', true)) === 'limit_reached', 'labelEvent 409');
    check(code(fn () => $c->unlabelEvent($valid, 'promo')) === 'not_found', 'unlabelEvent 404');

    // Guard
    $g = fn (array $o = []) => new Trace\Guard(...($o + ['secretKey' => 'sk_test', 'endpoint' => $endpoint]));
    $ok = $g()->check($valid);
    check($ok['ok'] && $ok['event']['suspectScore'] === 75, 'guard verifies');
    $none = $g()->check(null);
    check(!$none['ok'] && $none['status'] === 400 && $none['code'] === 'event_required', 'guard missing id');
    check($g(['required' => false])->check('')['ok'], 'guard optional');
    check($g(['rejectScore' => 75])->check($valid)['status'] === 403, 'guard rejectScore at threshold');
    check($g(['rejectScore' => 76])->check($valid)['ok'], 'guard rejectScore below');
    check($g(['reject' => fn (array $e) => $e['visitorId'] !== ''])->check($valid)['status'] === 403, 'guard reject callback');
    check($g()->check('01a1dcf6-53b8-7c68-bd1d-000000000000')['status'] === 400, 'guard unknown event');
    check($g()->check('nope')['status'] === 400, 'guard bad id');
    check($g(['secretKey' => 'sk_wrong', 'failOpen' => true])->check($valid)['status'] === 500, 'guard bad key never fails open');
    check($g(['secretKey' => null, 'endpoint' => null])->check($valid)['status'] === 500, 'guard missing config');
    $down = $g(['endpoint' => 'http://127.0.0.1:1', 'timeout' => 0.5]);
    check($down->check($valid)['status'] === 503, 'guard unreachable fails closed');
    $open = $g(['endpoint' => 'http://127.0.0.1:1', 'timeout' => 0.5, 'failOpen' => true])->check($valid);
    check($open['ok'] && $open['event'] === null, 'guard failOpen');

    // Laravel middleware, against stand-ins for the request and response
    if (!class_exists('Illuminate\Http\JsonResponse')) {
        eval('namespace Illuminate\Http; class JsonResponse { public function __construct(public array $data, public int $status) {} }');
    }
    $makeRequest = fn (?string $header, array $input = []) => new class($header, $input) {
        public object $attributes;
        public function __construct(private ?string $h, private array $i)
        {
            $this->attributes = new class { public array $bag = []; public function set(string $k, mixed $v): void { $this->bag[$k] = $v; } public function get(string $k): mixed { return $this->bag[$k] ?? null; } };
        }
        public function header(string $k): ?string { return $this->h; }
        public function input(string $k): mixed { return $this->i[$k] ?? null; }
    };
    putenv("TRACE_SECRET_KEY=sk_test");
    putenv("TRACE_ENDPOINT={$endpoint}");
    $mw = new Trace\Laravel\TraceMiddleware();
    $req = $makeRequest($valid);
    $res = $mw->handle($req, fn ($r) => 'next');
    check($res === 'next' && $req->attributes->get('trace')['suspectScore'] === 75, 'middleware header id');
    $req = $makeRequest(null, ['eventId' => $valid]);
    check($mw->handle($req, fn ($r) => 'next') === 'next', 'middleware input id');
    $res = $mw->handle($makeRequest(null), fn ($r) => 'next');
    check($res instanceof Illuminate\Http\JsonResponse && $res->status === 400 && $res->data['error']['code'] === 'event_required', 'middleware missing id');
    $res = $mw->handle($makeRequest($valid), fn ($r) => 'next', 'reject_score=70');
    check($res instanceof Illuminate\Http\JsonResponse && $res->status === 403, 'middleware reject_score');
    check($mw->handle($makeRequest(null), fn ($r) => 'next', 'optional') === 'next', 'middleware optional');
    putenv('TRACE_SECRET_KEY');
    putenv('TRACE_ENDPOINT');
} finally {
    proc_terminate($proc);
}

echo "{$passed} passed, {$failures} failed\n";
exit($failures === 0 ? 0 : 1);
