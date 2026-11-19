import { hashComponent, stableStringify } from './hash.js';
import { type ComponentName, type DeviceAttributes, type SignalPayload } from './types.js';

/** Screen component input. Shared with the browser SDK so both sides compute it the same way. */
export function screenKey(a: DeviceAttributes): string | null {
  if (a.screenWidth === null || a.screenHeight === null) return null;
  const long = Math.max(a.screenWidth, a.screenHeight);
  const short = Math.min(a.screenWidth, a.screenHeight);
  return `${long}x${short}|${a.colorDepth ?? ''}|${a.pixelRatio ?? ''}`;
}

/** Hardware component input. `touch` is "ontouchstart" in window, which only the browser knows. */
export function hardwareKey(a: DeviceAttributes, touch: boolean): string {
  return `${a.hardwareConcurrency ?? ''}|${a.deviceMemory ?? ''}|${a.maxTouchPoints ?? ''}|${touch}`;
}

/** The raw input of each component the SDK derives from the readable attributes (null: the SDK leaves it out). */
function expectedInputs(a: DeviceAttributes): Partial<Record<ComponentName, (string | null)[]>> {
  return {
    screen: [screenKey(a)],
    timezone: [a.timezone],
    languages: [a.languages.length > 0 ? a.languages.join(',') : null],
    platform: [stableStringify([a.platform, a.uaPlatform])],
    webgl: [a.webglVendor || a.webglRenderer ? `${a.webglVendor ?? ''}|${a.webglRenderer ?? ''}` : null],
    // Either value of the touch flag is legitimate; the server cannot see it.
    hardware: [hardwareKey(a, true), hardwareKey(a, false)],
  };
}

/** The hashed components an honest SDK derives from these attributes (touch: the browser's "ontouchstart" flag). */
export function derivedComponents(a: DeviceAttributes, touch = false): Partial<Record<ComponentName, string>> {
  const out: Partial<Record<ComponentName, string>> = {};
  for (const [name, inputs] of Object.entries(expectedInputs(a)) as [ComponentName, (string | null)[]][]) {
    const v = name === 'hardware' ? hardwareKey(a, touch) : inputs[0];
    if (v !== null && v !== undefined && v !== '') out[name] = hashComponent(v);
  }
  return out;
}

export interface IntegrityResult {
  checked: ComponentName[];
  mismatched: ComponentName[];
}

/**
 * Recomputes the components that the SDK hashes from the same readings it also sends in plain form. A payload whose
 * attributes do not hash to its own components was edited after collection (or built by hand). Components the payload
 * leaves out are not judged: a browser that cannot read something sends neither, and dropping components only costs
 * the sender identification quality.
 */
export function checkPayloadIntegrity(payload: SignalPayload): IntegrityResult {
  const checked: ComponentName[] = [];
  const mismatched: ComponentName[] = [];
  for (const [name, inputs] of Object.entries(expectedInputs(payload.attributes)) as [ComponentName, (string | null)[]][]) {
    const actual = payload.components[name];
    if (actual === undefined) continue;
    checked.push(name);
    const expected = inputs.map((v) => (v === null || v === '' ? undefined : hashComponent(v)));
    if (!expected.includes(actual)) mismatched.push(name);
  }
  return { checked, mismatched };
}
