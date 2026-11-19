import { describe, expect, it } from 'vitest';
import { BehaviorRecorder } from './behavior.js';

describe('BehaviorRecorder', () => {
  it('counts input and notices script-created (untrusted) events', () => {
    const rec = new BehaviorRecorder();
    for (let i = 0; i < 25; i++) dispatchEvent(new PointerEvent('pointermove', { clientX: i * 10, clientY: i * 10 }));
    dispatchEvent(new MouseEvent('click'));
    const s = rec.snapshot();
    expect(s).toMatchObject({ pointerMoves: 25, clicks: 1, keys: 0 });
    // Events dispatched from script are never trusted, which is exactly what the signal looks for.
    expect(s.untrusted).toBe(26);
    expect(s.straightness).toBe(1);
    rec.stop();
  });

  it('measures key timing without recording keys, and stops listening', () => {
    const rec = new BehaviorRecorder();
    for (let i = 0; i < 10; i++) dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    const s = rec.snapshot();
    expect(s.keys).toBe(10);
    expect(s.keyIntervalStdMs).not.toBeNull();
    expect(JSON.stringify(s)).not.toContain('"a"');
    rec.stop();
    dispatchEvent(new MouseEvent('click'));
    expect(rec.snapshot().clicks).toBe(0);
  });

  it('reports no straightness or typing rhythm from too little input', () => {
    const rec = new BehaviorRecorder();
    expect(rec.snapshot()).toMatchObject({ straightness: null, keyIntervalStdMs: null, untrusted: 0 });
    rec.stop();
  });
});
