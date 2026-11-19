<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Plugin settings. The secret key can live in wp-config.php (`define('TRACE_SECRET_KEY', 'sk_...');`) so it never
 * reaches the database; that wins over the saved value.
 */
final class Trace_Device_Settings
{
    public const OPTION = 'trace_device_settings';
    public const LOG_OPTION = 'trace_device_log';

    /** Contexts the plugin can protect. */
    public const CONTEXTS = [
        'login' => 'Login',
        'register' => 'Registration',
        'comment' => 'Comments',
        'woo_checkout' => 'WooCommerce checkout',
    ];

    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            'endpoint' => '',
            'public_key' => '',
            'secret_key' => '',
            // Shadow first: log what would have been blocked, block nothing.
            'mode' => 'shadow',
            'reject_score' => 80,
            // Let visitors through when the Trace server cannot be reached.
            'fail_open' => true,
            // Treat a form submitted without an identification as suspicious. Off: allow it (ad blockers, JS errors).
            'require_id' => false,
            'contexts' => ['login', 'register', 'comment', 'woo_checkout'],
        ];
    }

    /** @return array<string, mixed> */
    public static function get(): array
    {
        $saved = function_exists('get_option') ? get_option(self::OPTION, []) : [];
        $s = array_merge(self::defaults(), is_array($saved) ? $saved : []);
        if (defined('TRACE_SECRET_KEY') && is_string(TRACE_SECRET_KEY) && TRACE_SECRET_KEY !== '') {
            $s['secret_key'] = TRACE_SECRET_KEY;
        }
        return $s;
    }

    public static function secretFromConstant(): bool
    {
        return defined('TRACE_SECRET_KEY') && is_string(TRACE_SECRET_KEY) && TRACE_SECRET_KEY !== '';
    }

    /** Whether the plugin has what it needs to verify events. */
    public static function configured(array $s): bool
    {
        return $s['endpoint'] !== '' && str_starts_with((string) $s['secret_key'], 'sk_');
    }

    public static function protects(array $s, string $context): bool
    {
        return in_array($context, (array) $s['contexts'], true);
    }

    /**
     * Settings API sanitiser. A blank secret key keeps the saved one, so the form never has to print it back.
     *
     * @param mixed $input
     * @return array<string, mixed>
     */
    public static function sanitize($input): array
    {
        $saved = get_option(self::OPTION, []);
        $savedSecret = is_array($saved) ? (string) ($saved['secret_key'] ?? '') : '';
        $in = is_array($input) ? $input : [];
        $endpoint = rtrim(esc_url_raw((string) ($in['endpoint'] ?? '')), '/');
        $public = sanitize_text_field((string) ($in['public_key'] ?? ''));
        $secret = trim(sanitize_text_field((string) ($in['secret_key'] ?? '')));
        $contexts = array_values(array_intersect(array_keys(self::CONTEXTS), array_map('strval', (array) ($in['contexts'] ?? []))));
        return [
            'endpoint' => $endpoint,
            'public_key' => str_starts_with($public, 'pk_') ? $public : '',
            'secret_key' => $secret !== '' && str_starts_with($secret, 'sk_') ? $secret : $savedSecret,
            'mode' => ($in['mode'] ?? 'shadow') === 'enforce' ? 'enforce' : 'shadow',
            'reject_score' => max(1, min(100, (int) ($in['reject_score'] ?? 80))),
            'fail_open' => !empty($in['fail_open']),
            'require_id' => !empty($in['require_id']),
            'contexts' => $contexts,
        ];
    }
}
