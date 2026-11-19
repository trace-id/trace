# Trace for WordPress

A plugin that checks login, registration, comments and WooCommerce checkout against your own Trace server. It recognises the device behind each submission and, in enforce mode, refuses the ones whose suspect score is too high.

It starts in **shadow mode**: every protected form is checked and recorded under Settings, Trace, and nothing is blocked. Switch to enforce once the log looks right.

## Install

1. Zip the `trace-device` folder (or copy it to `wp-content/plugins/`) and activate **Trace Device Intelligence**. PHP 8.1 and WordPress 6.0 or later.
2. Settings, Trace: enter your server URL, public key (`pk_...`) and secret key (`sk_...`). Allow your site's origin on the public key in the dashboard.
3. Better: keep the secret key out of the database with `define('TRACE_SECRET_KEY', 'sk_...');` in `wp-config.php`.

## How it works

- The browser SDK is loaded from your own server (`/sdk/sdk.global.js`) only on pages with a protected form, and puts an event id in a hidden field (`trace_event_id`) of each form.
- On submit, the server verifies that id with your secret key (using `Trace\Guard` from the PHP SDK). Only the verified event counts; the visitor's browser can send anything.
- Blocked requests get a generic error. Blocked comments are held for moderation instead of discarded.

| Setting | Default | Meaning |
| --- | --- | --- |
| Mode | Shadow | Shadow logs only; Enforce blocks. |
| Block at score | 80 | Suspect score at or above this is refused in enforce mode. |
| Protect | all four | Login, registration, comments, WooCommerce checkout. |
| If Trace is unreachable | let through | A down Trace server never locks real visitors out. |
| Missing identification | allow | Treat a form without an event id as suspicious. Off by default: ad blockers block the script. |

A wrong key or missing configuration never blocks a visitor. XML-RPC, REST and application-password logins are never checked, because they cannot carry the field.

## Developing

The plugin bundles the PHP SDK in `trace-device/lib`. After changing `sdks/php/src`, run `node integrations/wordpress/sync-sdk.mjs`. Tests: `php integrations/wordpress/tests/run.php` (WordPress stand-ins; they test the logic and hook wiring, not a live WordPress).
