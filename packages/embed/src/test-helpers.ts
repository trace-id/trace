import { makePayload, type PayloadOverrides } from '@trace-id/signals/testing';
import { type Components } from '@trace-id/signals/types';

/** Hex component hashes, as the browser SDK sends them (the schema rejects anything else). */
export function hexComponents(seed: string): Components {
  const h = (name: string) => Buffer.from(`${seed}:${name}`).toString('hex').padEnd(16, '0').slice(0, 16);
  return {
    canvas: h('canvas'),
    webgl: h('webgl'),
    webglParams: h('webglParams'),
    audio: h('audio'),
    fonts: h('fonts'),
    screen: h('screen'),
    hardware: h('hardware'),
    timezone: h('timezone'),
    languages: h('languages'),
    platform: h('platform'),
    math: h('math'),
    css: h('css'),
    media: h('media'),
    userAgentFamily: h('ua'),
  };
}

/** A complete identify request body, as the SDK posts it. */
export function identifyBody(seed: string, extra: { token?: string; linkedId?: string; overrides?: PayloadOverrides } = {}) {
  return {
    signals: makePayload({ components: hexComponents(seed), ...extra.overrides }),
    sdk: { name: '@trace-id/sdk-js', version: '0.1.0' },
    ...(extra.token ? { token: extra.token } : {}),
    ...(extra.linkedId ? { linkedId: extra.linkedId } : {}),
  };
}

export const SECRET = 'test-secret-that-is-at-least-32-characters-long';
export const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
