import { hashComponent } from '@trace-id/signals/hash';
import { type Components } from '@trace-id/signals/types';
import { type Fixture, type FixtureSession } from './harness.js';

/**
 * A deterministic synthetic population. It models the collisions that make identification
 * hard (popular GPUs, default font sets, common screens and timezones) and the events that
 * break naive fingerprints (incognito, cleared storage, browser updates, external monitors,
 * travel). It is a regression guard, not a measure of real-world accuracy.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return (items[items.length - 1] as readonly [T, number])[0];
}

/** Zipf-like popularity: index 0 is most common. */
function zipf(rng: Rng, n: number): number {
  return weighted(
    rng,
    Array.from({ length: n }, (_, i) => [i, 1 / (i + 1)] as const),
  );
}

const OSES = [
  ['windows', 55],
  ['macos', 22],
  ['android', 12],
  ['ios', 7],
  ['linux', 4],
] as const;

type Os = (typeof OSES)[number][0];

const BROWSERS: Record<Os, readonly (readonly [string, number])[]> = {
  windows: [['chrome', 65], ['edge', 20], ['firefox', 15]],
  macos: [['safari', 45], ['chrome', 45], ['firefox', 10]],
  android: [['chrome', 80], ['samsung', 20]],
  ios: [['safari', 90], ['chrome', 10]],
  linux: [['firefox', 55], ['chrome', 45]],
};

interface DeviceState {
  id: string;
  os: Os;
  browser: string;
  gpu: number;
  screen: number;
  hardware: number;
  timezone: number;
  languages: number;
  fonts: string;
  browserVersion: number;
}

function components(d: DeviceState, overrides: { screen?: number; timezone?: number } = {}): Components {
  const h = (...parts: (string | number)[]) => hashComponent(parts.join('|'));
  const engine = d.browser === 'firefox' ? 'gecko' : d.browser === 'safari' || d.os === 'ios' ? 'webkit' : 'blink';
  return {
    canvas: h('canvas', d.os, d.gpu, engine, d.fonts),
    webgl: h('webgl', d.os, d.gpu),
    webglParams: h('webglParams', d.os, d.gpu, engine, Math.floor(d.browserVersion / 4)),
    audio: h('audio', d.os, engine, d.gpu % 3),
    fonts: h('fonts', d.os, d.fonts),
    screen: h('screen', d.os, overrides.screen ?? d.screen),
    hardware: h('hardware', d.os, d.hardware),
    timezone: h('tz', overrides.timezone ?? d.timezone),
    languages: h('lang', d.languages),
    platform: h('platform', d.os),
    math: h('math', engine, d.os),
    css: h('css', d.browser, d.browserVersion),
    media: h('media', d.os, d.screen % 2, Math.floor(d.browserVersion / 6)),
    userAgentFamily: h('ua', d.browser, d.os),
  };
}

function newDevice(rng: Rng, index: number): DeviceState {
  const os = weighted(rng, OSES);
  const mobile = os === 'android' || os === 'ios';
  const extraFonts = !mobile && rng() < 0.35;
  return {
    id: `d${index}`,
    os,
    browser: weighted(rng, BROWSERS[os]),
    gpu: zipf(rng, mobile ? 8 : 14),
    screen: zipf(rng, mobile ? 10 : 8),
    hardware: zipf(rng, 6),
    timezone: zipf(rng, 12),
    languages: zipf(rng, 8),
    fonts: extraFonts ? `extra-${Math.floor(rng() * 1e6)}` : 'default',
    browserVersion: 120 + Math.floor(rng() * 10),
  };
}

export function syntheticPopulation(seed = 1, deviceCount = 300): Fixture {
  const rng = mulberry32(seed);
  const timeline: { t: number; session: FixtureSession }[] = [];
  let sessionCounter = 0;

  for (let i = 0; i < deviceCount; i++) {
    const d = newDevice(rng, i);
    let profile = `${d.id}-p0`;
    let profileCounter = 0;
    let t = rng() * 1000;
    const emit = (scenario: string, comps: Components, sessionProfile = profile) => {
      timeline.push({
        t,
        session: { id: `s${++sessionCounter}`, device: d.id, profile: sessionProfile, scenario, components: comps },
      });
      t += 1 + rng() * 200;
    };

    emit('first', components(d));
    const extra = 1 + Math.floor(rng() * 5);
    for (let k = 0; k < extra; k++) {
      const scenario = weighted(rng, [
        ['return', 40],
        ['incognito', 18],
        ['cleared', 10],
        ['minor_update', 14],
        ['major_update', 5],
        ['external_monitor', 7],
        ['travel', 6],
      ] as const);
      switch (scenario) {
        case 'return':
          emit(scenario, components(d));
          break;
        case 'incognito':
          emit(scenario, components(d), `${d.id}-inc${++profileCounter}`);
          break;
        case 'cleared':
          profile = `${d.id}-p${++profileCounter}`;
          emit(scenario, components(d));
          break;
        case 'minor_update':
          d.browserVersion += 1;
          emit(scenario, components(d), rng() < 0.5 ? profile : `${d.id}-inc${++profileCounter}`);
          break;
        case 'major_update':
          d.browserVersion += 6;
          emit(scenario, components(d), rng() < 0.5 ? profile : `${d.id}-inc${++profileCounter}`);
          break;
        case 'external_monitor':
          emit(scenario, components(d, { screen: d.screen + 50 }), `${d.id}-inc${++profileCounter}`);
          break;
        case 'travel':
          emit(scenario, components(d, { timezone: d.timezone + 20 }), `${d.id}-inc${++profileCounter}`);
          break;
      }
    }
  }

  timeline.sort((a, b) => a.t - b.t || (a.session.id < b.session.id ? -1 : 1));
  return {
    name: `synthetic-population-seed${seed}`,
    description: `${deviceCount} synthetic devices with popularity-skewed hardware, default font sets and lifecycle events`,
    synthetic: true,
    sessions: timeline.map((e) => e.session),
  };
}
