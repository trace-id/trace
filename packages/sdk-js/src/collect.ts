import { hashComponent, stableStringify } from '@trace-id/signals/hash';
import { type BehaviorSummary, PAYLOAD_VERSION, type Components, type DeviceComponents, type SignalPayload } from '@trace-id/signals/types';
import { readAudio } from './collectors/audio.js';
import { readBotIndicators } from './collectors/bot.js';
import { readCanvas } from './collectors/canvas.js';
import { buildConsistency, readWorkerEnv } from './collectors/consistency.js';
import {
  readDisplayPrefs,
  readGpu,
  readKeyboardLayout,
  readMediaDecode,
  readScreenLayout,
  readVoices,
} from './collectors/device.js';
import { readDevtools } from './collectors/devtools.js';
import {
  detectEngine,
  readApiSurface,
  readCdp,
  readCodecs,
  readConnectionAndFrame,
  readSystemStyle,
  readWebgl2,
  readHighEntropy,
  readIntl,
  readMultiScreen,
  readPermissions,
  readPrivacyPrefs,
  readTextMetrics,
  readTimerResolution,
  readWebglRender,
} from './collectors/extended.js';
import { hardwareKey, readAttributes, screenKey } from './collectors/environment.js';
import { readCssFeatures, readMediaFeatures } from './collectors/features.js';
import { fontsMask, readFonts } from './collectors/fonts.js';
import { readPrivacy } from './collectors/incognito.js';
import { readMath } from './collectors/math.js';
import { readAdBlock, readExtensionMarkers, readExtensions, injectedExtensionIds } from './collectors/extensions.js';
import { readAvailability } from './collectors/storage.js';
import { readTamperIndicators } from './collectors/tamper.js';
import { browserFamily, osFamily } from './collectors/ua.js';
import { readWebgl } from './collectors/webgl.js';

export interface CollectOptions {
  /** Budget for each async probe (audio, storage estimate, permissions). */
  probeTimeoutMs?: number;
  /** Input behaviour recorded since the client started (see BehaviorRecorder). */
  behavior?: BehaviorSummary;
}

function put(components: Components, name: keyof Components, raw: string | null | undefined): void {
  if (raw !== null && raw !== undefined && raw !== '') components[name] = hashComponent(raw);
}

/** Gathers every signal. Raw readings are hashed here and never leave the page. */
export async function collectSignals(options: CollectOptions = {}): Promise<SignalPayload> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const probeTimeoutMs = options.probeTimeoutMs ?? 1000;

  const [audio, bot, privacy, voices, mediaDecode, keyboard, gpu, workerEnv, highEntropy, permissions, adBlock] = await Promise.all([
    readAudio(probeTimeoutMs),
    readBotIndicators(probeTimeoutMs),
    readPrivacy(probeTimeoutMs),
    readVoices(probeTimeoutMs),
    readMediaDecode(probeTimeoutMs),
    readKeyboardLayout(probeTimeoutMs),
    readGpu(probeTimeoutMs),
    readWorkerEnv(probeTimeoutMs),
    readHighEntropy(probeTimeoutMs),
    readPermissions(probeTimeoutMs),
    readAdBlock(probeTimeoutMs),
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
  put(components, 'intl', readIntl());
  put(components, 'textMetrics', readTextMetrics());
  put(components, 'webglRender', readWebglRender());
  put(components, 'webgpu', gpu.caps);
  put(components, 'apiSurface', readApiSurface());
  put(components, 'systemStyle', readSystemStyle());
  put(components, 'codecs', readCodecs());
  put(components, 'webgl2', readWebgl2());
  put(components, 'extensions', readExtensions());

  const device: DeviceComponents = {};
  if (voices) device.voices = hashComponent(voices);
  const displayPrefs = readDisplayPrefs();
  if (displayPrefs) device.displayPrefs = hashComponent(displayPrefs);
  // Not hashed: a bitmap of which common fonts are installed, so two browsers that measure one font differently still
  // match on the rest. It carries no more than the fonts hash does (that hash can be reversed by trying every bitmap).
  if (fonts && fonts.length > 0) device.fontsMask = fontsMask(fonts);
  const screenLayout = readScreenLayout();
  if (screenLayout) device.screenLayout = hashComponent(screenLayout);
  if (mediaDecode) device.mediaDecode = hashComponent(mediaDecode);
  if (keyboard) device.keyboard = hashComponent(keyboard);
  if (gpu.arch) device.gpuArch = hashComponent(gpu.arch);

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    v: PAYLOAD_VERSION,
    components,
    attributes,
    bot,
    tamper: readTamperIndicators(canvas.noisy),
    privacy,
    storage: readAvailability(),
    devtools: readDevtools(),
    device,
    consistency: buildConsistency(workerEnv, webgl.renderer),
    env: {
      engine: detectEngine(),
      uaPlatformVersion: highEntropy.uaPlatformVersion ?? null,
      uaArchitecture: highEntropy.uaArchitecture ?? null,
      uaBitness: highEntropy.uaBitness ?? null,
      uaModel: highEntropy.uaModel ?? null,
      uaFullVersion: highEntropy.uaFullVersion ?? null,
      timerResolutionMs: readTimerResolution(),
      permissions,
      cdp: readCdp(),
      multiScreen: readMultiScreen(),
      ...readPrivacyPrefs(),
      ...readConnectionAndFrame(),
      adBlock,
      extensionCount: readExtensionMarkers().length + injectedExtensionIds().length,
    },
    ...(options.behavior ? { behavior: options.behavior } : {}),
    collectMs: Math.max(0, Math.round(ended - started)),
  };
}
