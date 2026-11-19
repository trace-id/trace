import { checkPayloadIntegrity } from '@trace-id/signals/integrity';
import { COMPONENT_NAMES } from '@trace-id/signals/types';
import { describe, expect, it } from 'vitest';
import { collectSignals } from './collect.js';

describe('collectSignals', () => {
  it('produces payloads that pass the server integrity check (tamperedRequest)', async () => {
    const p = await collectSignals({ probeTimeoutMs: 50 });
    expect(checkPayloadIntegrity(p).mismatched).toEqual([]);
  });

  it('produces a well-formed payload in a minimal DOM without throwing', async () => {
    const p = await collectSignals({ probeTimeoutMs: 50 });
    expect(p.v).toBe(1);
    for (const [name, value] of Object.entries(p.components)) {
      expect(COMPONENT_NAMES).toContain(name);
      expect(value).toMatch(/^[0-9a-f]{28}$/);
    }
    expect(p.components.timezone).toBeDefined();
    expect(p.components.math).toBeDefined();
    expect(Array.isArray(p.bot.automationGlobals)).toBe(true);
    expect(Array.isArray(p.tamper.nativeOverrides)).toBe(true);
    expect(p.collectMs).toBeGreaterThanOrEqual(0);
    expect(p.devtools).toEqual({ likely: false, method: null });
    expect(typeof p.privacy.braveLikely).toBe('boolean');
  });

  it('is stable across calls', async () => {
    const a = await collectSignals({ probeTimeoutMs: 50 });
    const b = await collectSignals({ probeTimeoutMs: 50 });
    expect(b.components).toEqual(a.components);
  });

  it('flags automation globals', async () => {
    const w = window as unknown as Record<string, unknown>;
    w.__playwright__binding__ = () => undefined;
    try {
      const p = await collectSignals({ probeTimeoutMs: 50 });
      expect(p.bot.automationGlobals).toContain('__playwright__binding__');
    } finally {
      delete w.__playwright__binding__;
    }
  });

  it('flags a navigator property shadowed on the instance', async () => {
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    try {
      const p = await collectSignals({ probeTimeoutMs: 50 });
      expect(p.tamper.navigatorOwnProperties).toContain('webdriver');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).webdriver;
    }
  });
});
