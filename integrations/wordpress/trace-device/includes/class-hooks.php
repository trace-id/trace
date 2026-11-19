<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/** Server-side checks on login, registration, comments and WooCommerce checkout. */
final class Trace_Device_Hooks
{
    private const FIELD = 'trace_event_id';

    public function __construct(private Trace_Device_Decision $decision)
    {
    }

    public function register(): void
    {
        add_filter('registration_errors', [$this, 'onRegistration'], 20, 3);
        add_filter('woocommerce_process_registration_errors', [$this, 'onWooRegistration'], 20, 1);
        add_filter('authenticate', [$this, 'onAuthenticate'], 30, 3);
        add_filter('pre_comment_approved', [$this, 'onComment'], 20, 2);
        add_action('woocommerce_after_checkout_validation', [$this, 'onWooCheckout'], 20, 2);
    }

    private function eventId(): ?string
    {
        // The nonce for each form is checked by WordPress/WooCommerce itself before these filters run; this value is
        // only an id we then verify with the Trace server, never trusted on its own.
        // phpcs:ignore WordPress.Security.NonceVerification.Missing
        $raw = $_POST[self::FIELD] ?? null;
        return is_string($raw) ? sanitize_text_field(wp_unslash($raw)) : null;
    }

    private function check(string $context): ?array
    {
        $settings = Trace_Device_Settings::get();
        if (!Trace_Device_Settings::protects($settings, $context)) {
            return null;
        }
        return $this->decision->evaluate($settings, $context, $this->eventId());
    }

    private function message(): string
    {
        return __('We could not verify this request. Please try again, or contact the site owner if this keeps happening.', 'trace-device');
    }

    /** @param WP_Error $errors */
    public function onRegistration($errors, $sanitizedLogin = '', $email = '')
    {
        $r = $this->check('register');
        if ($r && $r['block'] && $errors instanceof WP_Error) {
            $errors->add('trace_blocked', $this->message());
        }
        return $errors;
    }

    /** @param WP_Error $errors */
    public function onWooRegistration($errors)
    {
        $r = $this->check('register');
        if ($r && $r['block'] && $errors instanceof WP_Error) {
            $errors->add('trace_blocked', $this->message());
        }
        return $errors;
    }

    /**
     * Only the login form (wp-login.php or WooCommerce); never XML-RPC, REST or application-password logins, which
     * cannot carry the field.
     *
     * @param mixed $user
     * @return mixed
     */
    public function onAuthenticate($user, $username = '', $password = '')
    {
        if (!($user instanceof WP_User) || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            return $user;
        }
        $isLoginForm = (isset($GLOBALS['pagenow']) && $GLOBALS['pagenow'] === 'wp-login.php') || isset($_POST['woocommerce-login-nonce']);
        if (!$isLoginForm) {
            return $user;
        }
        $r = $this->check('login');
        return $r && $r['block'] ? new WP_Error('trace_blocked', $this->message()) : $user;
    }

    /**
     * A blocked comment is held for moderation, not discarded: a person may still want to read it.
     *
     * @param mixed $approved
     * @param array<string, mixed> $commentData
     * @return mixed
     */
    public function onComment($approved, $commentData = [])
    {
        if ($approved === 'spam' || $approved instanceof WP_Error) {
            return $approved;
        }
        $r = $this->check('comment');
        return $r && $r['block'] ? 0 : $approved;
    }

    /**
     * @param array<string, mixed> $data
     * @param WP_Error $errors
     */
    public function onWooCheckout($data, $errors): void
    {
        $r = $this->check('woo_checkout');
        if ($r && $r['block'] && $errors instanceof WP_Error) {
            $errors->add('trace_blocked', $this->message());
        }
    }
}
