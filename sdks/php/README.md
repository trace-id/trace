# Trace (PHP)

Server SDK: verify events, webhooks and sealed results, and label events for the fraud score. PHP 8.1+, built-in extensions only (json, openssl, zlib).

```sh
composer require trace/trace
```

```php
use Trace\Client;
use Trace\VerifyError;

$client = new Client(getenv('TRACE_SECRET_KEY'), 'https://id.example.com');
try {
    $event = $client->getEvent($_POST['eventId']);
} catch (VerifyError $e) {
    // $e->errorCode: timeout, not_found, expired, unauthorized, ...
}
if ($event['suspectScore'] >= 60) { /* ... */ }

// Fraud score: label outcomes per fraud type (a chargeback, or a review that cleared the user)
$client->labelEvent($eventId, 'payment', true);
$client->unlabelEvent($eventId, 'payment');

// Webhooks: the raw body
$payload = Client::verifyWebhook(file_get_contents('php://input'), $_SERVER['HTTP_X_SIGNATURE'] ?? null, getenv('TRACE_WEBHOOK_SECRET'));

// Sealed results
$event = Client::unsealEventResult($_POST['sealedResult'], getenv('TRACE_SEALED_KEY'));
```

Guard and Laravel middleware (verify the event id a request carries; answers 400 missing or invalid, 403 rejected, 503 Trace unreachable, 500 bad key or configuration; `failOpen` never covers a bad key):

```php
$out = (new Trace\Guard(rejectScore: 80))->check($_SERVER['HTTP_X_TRACE_EVENT_ID'] ?? null);  // ['ok', 'event', 'status', 'code', 'message']

// Laravel: alias Trace\Laravel\TraceMiddleware as 'trace', then
Route::post('/signup', SignupController::class)->middleware('trace:reject_score=80,fail_open');
// $request->attributes->get('trace') is the verified event
```

Tests: `php tests/run.php`.
