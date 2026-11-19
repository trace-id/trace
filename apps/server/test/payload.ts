import { derivedComponents } from '@trace-id/signals/integrity';
import { makePayload as basePayload } from '@trace-id/signals/testing';

/**
 * Test payloads as the real SDK sends them: any component the SDK derives from readable attributes (screen, time zone,
 * languages, platform, GPU, hardware) is recomputed from those attributes, so only tests that mean to tamper trip
 * tamperedRequest. Components a test leaves out stay out, and the others keep whatever the test chose.
 */
export function makePayload(...args: Parameters<typeof basePayload>): ReturnType<typeof basePayload> {
  const p = basePayload(...args);
  const derived = derivedComponents(p.attributes);
  const components = { ...p.components };
  for (const name of Object.keys(components) as (keyof typeof components)[]) {
    if (name in derived) components[name] = derived[name];
  }
  return { ...p, components };
}
