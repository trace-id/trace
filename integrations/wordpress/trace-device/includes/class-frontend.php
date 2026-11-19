<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Loads the browser SDK from your own Trace server on pages that have a protected form, and puts the event id into a
 * hidden field of each form. The id is only a pointer: the server verifies it with your secret key.
 */
final class Trace_Device_Frontend
{
    private const FORMS = '#loginform, #registerform, #commentform, form.woocommerce-checkout, form.woocommerce-form-login, form.woocommerce-form-register';

    public function register(): void
    {
        add_action('wp_enqueue_scripts', [$this, 'enqueueSite']);
        add_action('login_enqueue_scripts', [$this, 'enqueueLogin']);
    }

    public function enqueueSite(): void
    {
        $s = Trace_Device_Settings::get();
        $needed = (Trace_Device_Settings::protects($s, 'comment') && is_singular() && comments_open())
            || (function_exists('is_checkout') && Trace_Device_Settings::protects($s, 'woo_checkout') && is_checkout())
            || (function_exists('is_account_page') && is_account_page()
                && (Trace_Device_Settings::protects($s, 'login') || Trace_Device_Settings::protects($s, 'register')));
        if ($needed) {
            $this->enqueue($s);
        }
    }

    public function enqueueLogin(): void
    {
        $s = Trace_Device_Settings::get();
        if (Trace_Device_Settings::protects($s, 'login') || Trace_Device_Settings::protects($s, 'register')) {
            $this->enqueue($s);
        }
    }

    /** @param array<string, mixed> $s */
    private function enqueue(array $s): void
    {
        if ($s['endpoint'] === '' || !str_starts_with((string) $s['public_key'], 'pk_')) {
            return;
        }
        $src = esc_url_raw(rtrim((string) $s['endpoint'], '/') . '/sdk/sdk.global.js');
        wp_enqueue_script('trace-device-sdk', $src, [], null, ['in_footer' => true, 'strategy' => 'defer']);
        $config = wp_json_encode([
            'endpoint' => (string) $s['endpoint'],
            'publicKey' => (string) $s['public_key'],
            'forms' => self::FORMS,
        ]);
        wp_add_inline_script('trace-device-sdk', 'window.TraceDevice=' . $config . ';' . self::js());
    }

    private static function js(): string
    {
        return <<<'JS'
(function () {
  var c = window.TraceDevice;
  if (!c || !window.Trace || !window.Trace.createClient) return;
  var client = window.Trace.createClient({ apiKey: c.publicKey, endpoint: c.endpoint });
  var last = '';
  function fill() {
    document.querySelectorAll(c.forms).forEach(function (f) {
      var i = f.querySelector('input[name="trace_event_id"]');
      if (!i) { i = document.createElement('input'); i.type = 'hidden'; i.name = 'trace_event_id'; f.appendChild(i); }
      i.value = last;
    });
  }
  function run() {
    fill();
    client.get({ tags: { source: 'wordpress' } }).then(function (r) { last = r.eventId; fill(); }).catch(function () {});
  }
  run();
  // Events can be verified for 60 minutes; refresh well before that for long-lived pages.
  setInterval(run, 45 * 60 * 1000);
  // WooCommerce re-renders the checkout form through AJAX.
  if (window.jQuery) window.jQuery(document.body).on('updated_checkout', fill);
})();
JS;
    }
}
