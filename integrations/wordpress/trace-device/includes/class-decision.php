<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Turns "this form carried event id X" into allow or block, using Trace\Guard. No WordPress calls except the log, so it
 * is unit-tested on its own.
 */
final class Trace_Device_Decision
{
    private const LOG_MAX = 50;

    /**
     * @param array<string, mixed> $settings
     * @return array{block: bool, would_block: bool, reason: string, event: ?array<string, mixed>}
     *   block: refuse the request now. would_block: enforce mode would have refused it (shown in shadow mode).
     */
    public function evaluate(array $settings, string $context, ?string $eventId): array
    {
        $eventId = $eventId !== null ? trim($eventId) : null;
        if (!Trace_Device_Settings::configured($settings)) {
            return $this->result($settings, $context, false, 'not_configured', null);
        }
        if ($eventId === null || $eventId === '') {
            // No identification arrived: ad blocker, script error, or a bot that never ran the script.
            return $this->result($settings, $context, (bool) $settings['require_id'], 'no_event_id', null);
        }
        $out = (new Trace\Guard(
            secretKey: (string) $settings['secret_key'],
            endpoint: (string) $settings['endpoint'],
            timeout: 2.0,
            failOpen: (bool) $settings['fail_open'],
            rejectScore: (int) $settings['reject_score'],
        ))->check($eventId);

        if ($out['ok']) {
            return $this->result($settings, $context, false, $out['event'] === null ? 'trace_unreachable_allowed' : 'allowed', $out['event']);
        }
        // 400 invalid/expired id and 403 over the score are the visitor's doing. 500 and 503 are ours: never punish a
        // visitor for a misconfigured or unreachable server.
        $theirs = $out['status'] === 403 || $out['status'] === 400;
        return $this->result($settings, $context, $theirs, $out['code'], null);
    }

    /**
     * @param array<string, mixed> $settings
     * @param ?array<string, mixed> $event
     * @return array{block: bool, would_block: bool, reason: string, event: ?array<string, mixed>}
     */
    private function result(array $settings, string $context, bool $wouldBlock, string $reason, ?array $event): array
    {
        $block = $wouldBlock && $settings['mode'] === 'enforce';
        $this->log($context, $reason, $wouldBlock, $block, $event);
        return ['block' => $block, 'would_block' => $wouldBlock, 'reason' => $reason, 'event' => $event];
    }

    /** @param ?array<string, mixed> $event */
    private function log(string $context, string $reason, bool $wouldBlock, bool $blocked, ?array $event): void
    {
        if (!function_exists('get_option') || !function_exists('update_option')) {
            return;
        }
        $log = get_option(Trace_Device_Settings::LOG_OPTION, []);
        $log = is_array($log) ? $log : [];
        array_unshift($log, [
            'time' => time(),
            'context' => $context,
            'reason' => $reason,
            'would_block' => $wouldBlock,
            'blocked' => $blocked,
            'visitor' => $event['visitorId'] ?? null,
            'score' => isset($event['suspectScore']) ? (float) $event['suspectScore'] : null,
        ]);
        update_option(Trace_Device_Settings::LOG_OPTION, array_slice($log, 0, self::LOG_MAX), false);
    }
}
