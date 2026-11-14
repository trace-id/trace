import { safe } from './safe.js';

export interface CanvasReading {
  image: string | null;
  noisy: boolean;
}

function render(): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 60;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f60';
  ctx.fillRect(100, 1, 62, 20);
  ctx.fillStyle = '#069';
  ctx.font = '11pt "Times New Roman"';
  ctx.fillText('Cwm fjordbank gly \u{1F603}', 2, 15);
  ctx.fillStyle = 'rgba(102, 204, 0, 0.2)';
  ctx.font = '18pt Arial';
  ctx.fillText('Cwm fjordbank gly \u{1F603}', 4, 45);
  ctx.globalCompositeOperation = 'multiply';
  for (const [color, x] of [
    ['#f2f', 40],
    ['#2ff', 80],
    ['#ff2', 60],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, 30, 20, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
  }
  return canvas.toDataURL();
}

/**
 * Renders twice: browsers that farble canvas (Brave, Firefox RFP, extensions) produce
 * different output each time, which makes the reading useless for identity.
 */
export function readCanvas(): CanvasReading {
  return safe(
    () => {
      const first = render();
      if (first === null || first.length < 32) return { image: null, noisy: false };
      const second = render();
      if (second !== first) return { image: null, noisy: true };
      return { image: first, noisy: false };
    },
    { image: null, noisy: false },
  );
}
