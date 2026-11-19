<?php
/**
 * Plugin Name:       Trace Device Intelligence
 * Description:       Recognise returning visitors and score fraud risk on login, registration, comments and WooCommerce checkout, with your own self-hosted Trace server.
 * Version:           0.1.0
 * Requires PHP:      8.1
 * Requires at least: 6.0
 * License:           MIT
 * Text Domain:       trace-device
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('TRACE_DEVICE_VERSION', '0.1.0');
define('TRACE_DEVICE_DIR', __DIR__);

require_once __DIR__ . '/lib/Trace.php';
require_once __DIR__ . '/lib/Guard.php';
require_once __DIR__ . '/includes/class-settings.php';
require_once __DIR__ . '/includes/class-decision.php';
require_once __DIR__ . '/includes/class-hooks.php';
require_once __DIR__ . '/includes/class-frontend.php';
require_once __DIR__ . '/includes/class-admin.php';

add_action('plugins_loaded', static function (): void {
    (new Trace_Device_Hooks(new Trace_Device_Decision()))->register();
    (new Trace_Device_Frontend())->register();
    if (is_admin()) {
        (new Trace_Device_Admin())->register();
    }
});
