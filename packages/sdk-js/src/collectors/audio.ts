import { safeAsync } from './safe.js';

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** Sum of rendered compressor output: varies with the audio stack, stable per device/browser. */
export function readAudio(timeoutMs: number): Promise<string | null> {
  return safeAsync(
    async () => {
      const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
      const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor(1, 5000, 44100);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -50;
      comp.knee.value = 40;
      comp.ratio.value = 12;
      comp.attack.value = 0;
      comp.release.value = 0.25;
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      const buffer = await ctx.startRendering();
      const data = buffer.getChannelData(0);
      let sum = 0;
      for (let i = 4500; i < data.length; i++) sum += Math.abs(data[i] ?? 0);
      return sum.toString();
    },
    null,
    timeoutMs,
  );
}
