import { hashComponent, stableStringify } from '@tbdname/signals/hash';
import { PAYLOAD_VERSION, type Components, type SignalPayload } from '@tbdname/signals/types';
import { readAudio } from './collectors/audio.js';
import { readBotIndicators } from './collectors/bot.js';
import { readCanvas } from './collectors/canvas.js';
import { hardwareKey, readAttributes, screenKey } from './collectors/environment.js';
import { readCssFeatures, readMediaFeatures } from './collectors/features.js';
import { readFonts } from './collectors/fonts.js';
import { readPrivacy } from './collectors/incognito.js';
import { readMath } from './collectors/math.js';
import { readAvailability } from './collectors/storage.js';
import { readTamperIndicators } from './collectors/tamper.js';
import { browserFamily, osFamily } from './collectors/ua.js';
import { readWebgl } from './collectors/webgl.js';

export interface CollectOptions {
  /** Budget for each async probe (audio, storage estimate, permissions). */
  probeTimeoutMs?: number;
}

function put(components: Components, name: keyof Components, raw: string | null | undefined): void {
  if (raw !== null && raw !== undefined && raw !== '') components[name] = hashComponent(raw);
}

/** Gathers every signal. Raw readings are hashed here and never leave the page. */
export async function collectSignals(options: CollectOptions = {}): Promise<SignalPayload> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const probeTimeoutMs = options.probeTimeoutMs ?? 1000;

  const [audio, bot, privacy] = await Promise.all([
    readAudio(probeTimeoutMs),
    readBotIndicators(probeTimeoutMs),
    readPrivacy(probeTimeoutMs),
  ]);
  const canvas = readCanvas();
  const webgl = readWebgl();
  const fonts = readFonts();
  const attributes = readAttributes(webgl.vendor, webgl.renderer);

  const components: Components = {};
  put(components, 'canvas', canvas.image);
  put(components, 'webgl', webgl.vendor || webgl.renderer ? `${webgl.vendor ?? ''}|${webgl.renderer ?? ''}` : null);
  put(components, 'webglParams', webgl.params);
  put(components, 'audio', audio);
  put(components, 'fonts', fonts && fonts.length > 0 ? fonts.join(',') : null);
  put(components, 'screen', screenKey(attributes));
  put(components, 'hardware', hardwareKey(attributes));
  put(components, 'timezone', attributes.timezone);
  put(components, 'languages', attributes.languages.length > 0 ? attributes.languages.join(',') : null);
  put(components, 'platform', stableStringify([attributes.platform, attributes.uaPlatform]));
  put(components, 'math', readMath());
  put(components, 'css', readCssFeatures());
  put(components, 'media', readMediaFeatures());
  const ua = attributes.userAgent ?? '';
  put(components, 'userAgentFamily', ua ? `${browserFamily(ua)}|${osFamily(ua)}` : null);

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    v: PAYLOAD_VERSION,
    components,
    attributes,
    bot,
    tamper: readTamperIndicators(canvas.noisy),
    privacy,
    storage: readAvailability(),
    collectMs: Math.max(0, Math.round(ended - started)),
  };
}
