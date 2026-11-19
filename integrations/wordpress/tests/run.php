<?php

declare(strict_types=1);

// Dependency-free tests with small WordPress stand-ins: php integrations/wordpress/tests/run.php
// They exercise the plugin's logic and hook wiring. They do not boot WordPress itself.

define('ABSPATH', __DIR__ . '/');

$store = [];
$hooks = [];

class WP_Error
{
    /** @var array<string, string[]> */
    public array $errors = [];
    public function __construct(string $code = '', string $message = '')
    {
        if ($code !== '') {
            $this->errors[$code][] = $message;
        }
    }
    public function add(string $code, string $message): void
    {
        $this->errors[$code][] = $message;
    }
}
class WP_User
{
}

function add_filter(string $tag, callable $cb, int $priority = 10, int $args = 1): void
{
    global $hooks;
    $hooks[$tag][] = $cb;
}
function add_action(string $tag, callable $cb, int $priority = 10, int $args = 1): void
{
    add_filter($tag, $cb, $priority, $args);
}
function get_option(string $name, $default = false)
{
    global $store;
    return $store[$name] ?? $default;
}
function update_option(string $name, $value, $autoload = null): bool
{
    global $store;
    $store[$name] = $value;
    return true;
}
function sanitize_text_field(string $s): string
{
    return trim(strip_tags($s));
}
function wp_unslash($v)
{
    return $v;
}
function esc_url_raw(string $u): string
{
    return filter_var($u, FILTER_VALIDATE_URL) ? $u : '';
}
function __(string $s, string $domain = ''): string
{
    return $s;
}

$pluginDir = __DIR__ . '/../trace-device';
require $pluginDir . '/lib/Trace.php';
require $pluginDir . '/lib/Guard.php';
require $pluginDir . '/includes/class-settings.php';
require $pluginDir . '/includes/class-decision.php';
require $pluginDir . '/includes/class-hooks.php';

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

$sdkTests = __DIR__ . '/../../../sdks/php/tests';
$v = json_decode((string) file_get_contents($sdkTests . '/../../test-vectors/vectors.json'), true);
$valid = $v['eventId']['valid'];

// The bundled SDK copy must match the source.
foreach (['Trace.php', 'Guard.php'] as $f) {
    check(file_get_contents($pluginDir . '/lib/' . $f) === file_get_contents(__DIR__ . '/../../../sdks/php/src/' . $f), "lib/{$f} is in sync (run: node integrations/wordpress/sync-sdk.mjs)");
}

$port = 8791;
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$port}", $sdkTests . '/router.php'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
usleep(600000);
$endpoint = "http://127.0.0.1:{$port}";

try {
    $base = array_merge(Trace_Device_Settings::defaults(), ['endpoint' => $endpoint, 'secret_key' => 'sk_test']);
    $d = new Trace_Device_Decision();

    // Settings
    $s = Trace_Device_Settings::sanitize(['endpoint' => $endpoint . '/', 'public_key' => 'pk_abc', 'secret_key' => 'sk_new', 'mode' => 'enforce', 'reject_score' => '500', 'contexts' => ['login', 'bogus']]);
    check($s['endpoint'] === $endpoint && $s['secret_key'] === 'sk_new' && $s['mode'] === 'enforce' && $s['reject_score'] === 100 && $s['contexts'] === ['login'], 'sanitize cleans input');
    update_option(Trace_Device_Settings::OPTION, ['secret_key' => 'sk_saved']);
    check(Trace_Device_Settings::sanitize(['secret_key' => ''])['secret_key'] === 'sk_saved', 'blank secret keeps the saved one');
    check(Trace_Device_Settings::sanitize(['secret_key' => 'pk_oops'])['secret_key'] === 'sk_saved', 'a non-secret key is refused');
    check(Trace_Device_Settings::sanitize(['public_key' => 'sk_x'])['public_key'] === '', 'a secret key in the public field is dropped');
    check(Trace_Device_Settings::defaults()['mode'] === 'shadow', 'shadow is the default mode');
    $store = [];

    // Decisions
    $r = $d->evaluate(array_merge($base, ['endpoint' => '']), 'login', $valid);
    check(!$r['block'] && $r['reason'] === 'not_configured', 'unconfigured allows');
    $r = $d->evaluate(array_merge($base, ['reject_score' => 70]), 'login', $valid);
    check(!$r['block'] && $r['would_block'] && $r['reason'] === 'trace_rejected', 'shadow mode logs would-block but never blocks');
    $enforce = array_merge($base, ['mode' => 'enforce', 'reject_score' => 70]);
    check($d->evaluate($enforce, 'login', $valid)['block'], 'enforce blocks at the score');
    check(!$d->evaluate(array_merge($enforce, ['reject_score' => 76]), 'login', $valid)['block'], 'enforce allows below the score');
    $r = $d->evaluate($enforce, 'login', null);
    check(!$r['block'] && $r['reason'] === 'no_event_id', 'missing id is allowed by default');
    check($d->evaluate(array_merge($enforce, ['require_id' => true]), 'login', '')['block'], 'missing id blocks when required');
    check($d->evaluate($enforce, 'login', '01a1dcf6-53b8-7c68-bd1d-000000000000')['block'], 'an unknown event id blocks');
    check(!$d->evaluate(array_merge($enforce, ['secret_key' => 'sk_wrong']), 'login', $valid)['block'], 'a bad key never punishes the visitor');
    $down = array_merge($enforce, ['endpoint' => 'http://127.0.0.1:1']);
    check(!$d->evaluate($down, 'login', $valid)['block'], 'unreachable server never punishes the visitor');
    check($d->evaluate(array_merge($down, ['fail_open' => true]), 'login', $valid)['reason'] === 'trace_unreachable_allowed', 'fail open is recorded');
    $log = get_option(Trace_Device_Settings::LOG_OPTION, []);
    check(count($log) >= 10 && isset($log[0]['reason']) && $log[count($log) - 1]['context'] === 'login', 'decisions are logged');
    for ($i = 0; $i < 70; $i++) {
        $d->evaluate($base, 'comment', null);
    }
    check(count(get_option(Trace_Device_Settings::LOG_OPTION)) === 50, 'the log is capped at 50');

    // Hooks
    $h = new Trace_Device_Hooks($d);
    $h->register();
    foreach (['registration_errors', 'authenticate', 'pre_comment_approved', 'woocommerce_after_checkout_validation', 'woocommerce_process_registration_errors'] as $tag) {
        check(!empty($hooks[$tag]), "hook {$tag} registered");
    }
    $store[Trace_Device_Settings::OPTION] = array_merge($enforce, ['contexts' => ['login', 'register', 'comment', 'woo_checkout']]);
    $_POST['trace_event_id'] = $valid;

    $e = $h->onRegistration(new WP_Error(), 'u', 'u@x.test');
    check(isset($e->errors['trace_blocked']), 'registration is blocked in enforce mode');
    $e = $h->onWooRegistration(new WP_Error());
    check(isset($e->errors['trace_blocked']), 'WooCommerce registration is blocked');
    $errors = new WP_Error();
    $h->onWooCheckout([], $errors);
    check(isset($errors->errors['trace_blocked']), 'WooCommerce checkout is blocked');
    check($h->onComment(1, []) === 0, 'a blocked comment is held for moderation');
    check($h->onComment('spam', []) === 'spam', 'a spam verdict is left alone');

    $_SERVER['REQUEST_METHOD'] = 'POST';
    $user = new WP_User();
    check($h->onAuthenticate($user, 'u', 'p') === $user, 'login outside the login form is not checked');
    $GLOBALS['pagenow'] = 'wp-login.php';
    $r = $h->onAuthenticate($user, 'u', 'p');
    check($r instanceof WP_Error && isset($r->errors['trace_blocked']), 'wp-login.php login is blocked');
    $_SERVER['REQUEST_METHOD'] = 'GET';
    check($h->onAuthenticate($user, 'u', 'p') === $user, 'a GET is never blocked');
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $err = new WP_Error('x', 'y');
    check($h->onAuthenticate($err, 'u', 'p') === $err, 'an existing auth error passes through untouched');

    $store[Trace_Device_Settings::OPTION] = array_merge($enforce, ['contexts' => ['comment']]);
    $e = $h->onRegistration(new WP_Error(), 'u', 'u@x.test');
    check(!isset($e->errors['trace_blocked']), 'contexts you did not select are skipped');
    $store[Trace_Device_Settings::OPTION] = array_merge($base, ['reject_score' => 70]);
    $e = $h->onRegistration(new WP_Error(), 'u', 'u@x.test');
    check(!isset($e->errors['trace_blocked']), 'shadow mode never blocks registration');
} finally {
    proc_terminate($proc);
}

echo "{$passed} passed, {$failures} failed\n";
exit($failures === 0 ? 0 : 1);
