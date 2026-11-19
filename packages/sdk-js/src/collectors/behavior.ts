import { type BehaviorSummary } from '@trace-id/signals/types';
import { safe } from './safe.js';

/**
 * Input behaviour between SDK start and identify. Only counts and timing statistics are kept: never which keys were
 * pressed, never coordinates, never targets. Listeners are passive and removed by stop().
 */
export class BehaviorRecorder {
  private readonly started = Date.now();
  private pointerMoves = 0;
  private clicks = 0;
  private keys = 0;
  private scrolls = 0;
  private touches = 0;
  private untrusted = 0;
  private path = 0;
  private lastX: number | null = null;
  private lastY: number | null = null;
  private firstX: number | null = null;
  private firstY: number | null = null;
  private lastKeyAt: number | null = null;
  private readonly keyIntervals: number[] = [];
  private readonly listeners: [string, (e: Event) => void][] = [];

  constructor() {
    safe(() => {
      if (typeof addEventListener !== 'function') return;
      const on = (type: string, fn: (e: Event) => void) => {
        addEventListener(type, fn, { passive: true, capture: true });
        this.listeners.push([type, fn]);
      };
      const trust = (e: Event) => {
        if (!e.isTrusted) this.untrusted++;
      };
      on('pointermove', (e) => {
        trust(e);
        this.pointerMoves++;
        const { clientX: x, clientY: y } = e as PointerEvent;
        if (this.firstX === null) {
          this.firstX = x;
          this.firstY = y;
        } else if (this.lastX !== null && this.lastY !== null) {
          this.path += Math.hypot(x - this.lastX, y - this.lastY);
        }
        this.lastX = x;
        this.lastY = y;
      });
      on('click', (e) => {
        trust(e);
        this.clicks++;
      });
      on('keydown', (e) => {
        trust(e);
        this.keys++;
        const now = e.timeStamp;
        if (this.lastKeyAt !== null && this.keyIntervals.length < 200) this.keyIntervals.push(now - this.lastKeyAt);
        this.lastKeyAt = now;
      });
      on('wheel', () => this.scrolls++);
      on('touchstart', (e) => {
        trust(e);
        this.touches++;
      });
    }, undefined);
  }

  snapshot(): BehaviorSummary {
    const straight =
      this.pointerMoves >= 20 && this.path > 0 && this.firstX !== null && this.lastX !== null
        ? Math.min(1, Math.hypot(this.lastX - this.firstX, this.lastY! - this.firstY!) / this.path)
        : null;
    let keyStd: number | null = null;
    if (this.keyIntervals.length >= 8) {
      const mean = this.keyIntervals.reduce((a, b) => a + b, 0) / this.keyIntervals.length;
      keyStd = Math.sqrt(this.keyIntervals.reduce((a, b) => a + (b - mean) ** 2, 0) / this.keyIntervals.length);
    }
    const round = (n: number | null, d: number) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);
    return {
      msSinceStart: Date.now() - this.started,
      pointerMoves: this.pointerMoves,
      clicks: this.clicks,
      keys: this.keys,
      scrolls: this.scrolls,
      touches: this.touches,
      untrusted: this.untrusted,
      straightness: round(straight, 3),
      keyIntervalStdMs: round(keyStd, 1),
    };
  }

  stop(): void {
    for (const [type, fn] of this.listeners.splice(0)) safe(() => removeEventListener(type, fn, { capture: true }), undefined);
  }
}
