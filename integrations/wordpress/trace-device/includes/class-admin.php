<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/** Settings page (Settings, Trace) with the recent decisions, so you can see what enforce mode would do. */
final class Trace_Device_Admin
{
    private const PAGE = 'trace-device';

    public function register(): void
    {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_init', [$this, 'settings']);
    }

    public function menu(): void
    {
        add_options_page('Trace', 'Trace', 'manage_options', self::PAGE, [$this, 'render']);
    }

    public function settings(): void
    {
        register_setting('trace_device', Trace_Device_Settings::OPTION, [
            'type' => 'array',
            'sanitize_callback' => [Trace_Device_Settings::class, 'sanitize'],
            'default' => Trace_Device_Settings::defaults(),
        ]);
    }

    public function render(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = Trace_Device_Settings::get();
        $name = Trace_Device_Settings::OPTION;
        $log = get_option(Trace_Device_Settings::LOG_OPTION, []);
        $log = is_array($log) ? $log : [];
        echo '<div class="wrap"><h1>Trace</h1>';
        if ($s['mode'] === 'shadow') {
            echo '<div class="notice notice-info"><p><strong>Shadow mode.</strong> Trace checks every protected form and records the result below, but blocks nothing. Switch to enforce once the log looks right.</p></div>';
        }
        if (!Trace_Device_Settings::configured($s)) {
            echo '<div class="notice notice-warning"><p>Add your server URL and a secret key to start verifying.</p></div>';
        }
        echo '<form method="post" action="options.php">';
        settings_fields('trace_device');
        echo '<table class="form-table" role="presentation">';
        $this->row('Server URL', '<input type="url" class="regular-text" name="' . esc_attr($name) . '[endpoint]" value="' . esc_attr((string) $s['endpoint']) . '" placeholder="https://id.example.com">');
        $this->row('Public key', '<input type="text" class="regular-text code" name="' . esc_attr($name) . '[public_key]" value="' . esc_attr((string) $s['public_key']) . '" placeholder="pk_...">');
        if (Trace_Device_Settings::secretFromConstant()) {
            $this->row('Secret key', '<em>Set by <code>TRACE_SECRET_KEY</code> in wp-config.php.</em>');
        } else {
            $hint = str_starts_with((string) $s['secret_key'], 'sk_') ? 'A key is saved. Leave blank to keep it.' : 'sk_...';
            $this->row('Secret key', '<input type="password" autocomplete="off" class="regular-text code" name="' . esc_attr($name) . '[secret_key]" value="" placeholder="' . esc_attr($hint) . '"><p class="description">Better still, define <code>TRACE_SECRET_KEY</code> in wp-config.php so it never reaches the database.</p>');
        }
        $this->row('Mode', '<label><input type="radio" name="' . esc_attr($name) . '[mode]" value="shadow"' . checked($s['mode'], 'shadow', false) . '> Shadow (log only)</label><br><label><input type="radio" name="' . esc_attr($name) . '[mode]" value="enforce"' . checked($s['mode'], 'enforce', false) . '> Enforce (block)</label>');
        $this->row('Block at score', '<input type="number" min="1" max="100" name="' . esc_attr($name) . '[reject_score]" value="' . esc_attr((string) (int) $s['reject_score']) . '" class="small-text"> and above');
        $boxes = '';
        foreach (Trace_Device_Settings::CONTEXTS as $key => $label) {
            $boxes .= '<label><input type="checkbox" name="' . esc_attr($name) . '[contexts][]" value="' . esc_attr($key) . '"' . checked(in_array($key, (array) $s['contexts'], true), true, false) . '> ' . esc_html($label) . '</label><br>';
        }
        $this->row('Protect', $boxes);
        $this->row('If Trace is unreachable', '<label><input type="checkbox" name="' . esc_attr($name) . '[fail_open]" value="1"' . checked(!empty($s['fail_open']), true, false) . '> Let visitors through</label>');
        $this->row('Missing identification', '<label><input type="checkbox" name="' . esc_attr($name) . '[require_id]" value="1"' . checked(!empty($s['require_id']), true, false) . '> Treat as suspicious</label><p class="description">Leave off unless you are sure no real visitor blocks the script (ad blockers do).</p>');
        echo '</table>';
        submit_button();
        echo '</form><h2>Recent decisions</h2>';
        if (!$log) {
            echo '<p>Nothing yet.</p>';
        } else {
            echo '<table class="widefat striped"><thead><tr><th>Time</th><th>Where</th><th>Result</th><th>Visitor</th><th>Score</th></tr></thead><tbody>';
            foreach ($log as $e) {
                $result = !empty($e['blocked']) ? 'Blocked' : (!empty($e['would_block']) ? 'Would block' : 'Allowed');
                echo '<tr><td>' . esc_html(wp_date('Y-m-d H:i:s', (int) $e['time'])) . '</td><td>' . esc_html((string) $e['context']) . '</td><td>' . esc_html($result . ' (' . $e['reason'] . ')') . '</td><td><code>' . esc_html((string) ($e['visitor'] ?? '')) . '</code></td><td>' . esc_html($e['score'] === null ? '' : (string) $e['score']) . '</td></tr>';
            }
            echo '</tbody></table>';
        }
        echo '</div>';
    }

    private function row(string $label, string $html): void
    {
        // $html is built above from escaped parts only.
        echo '<tr><th scope="row">' . esc_html($label) . '</th><td>' . $html . '</td></tr>'; // phpcs:ignore WordPress.Security.EscapeOutput
    }
}
