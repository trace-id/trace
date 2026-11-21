import { COMPONENT_NAMES, DEVICE_COMPONENT_NAMES } from '@trace-id/signals/types';
import { z } from 'zod';

const str = (max: number) => z.string().max(max);
const nullableNum = z.number().finite().min(0).max(1_000_000).nullable();
const identifier = z.string().max(64).regex(/^[\w$.-]*$/);

const attributes = z
  .object({
    screenWidth: nullableNum,
    screenHeight: nullableNum,
    availWidth: nullableNum,
    availHeight: nullableNum,
    colorDepth: nullableNum,
    pixelRatio: nullableNum,
    hardwareConcurrency: nullableNum,
    deviceMemory: nullableNum,
    maxTouchPoints: nullableNum,
    timezone: str(64).nullable(),
    languages: z.array(str(35)).max(10),
    platform: str(64).nullable(),
    userAgent: str(512).nullable(),
    uaBrands: z.array(z.object({ brand: str(64), version: str(32) }).strict()).max(10),
    uaMobile: z.boolean().nullable(),
    uaPlatform: str(64).nullable(),
    webglVendor: str(256).nullable(),
    webglRenderer: str(256).nullable(),
  })
  .strict();

const signals = z
  .object({
    v: z.literal(1),
    components: z.partialRecord(z.enum(COMPONENT_NAMES), z.string().regex(/^[0-9a-f]{8,64}$/)),
    attributes,
    bot: z
      .object({
        webdriver: z.boolean(),
        headlessUserAgent: z.boolean(),
        automationGlobals: z.array(identifier).max(32),
        noPlugins: z.boolean(),
        noLanguages: z.boolean(),
        permissionsInconsistent: z.boolean(),
        chromeObjectMissing: z.boolean(),
        zeroOuterSize: z.boolean(),
      })
      .strict(),
    tamper: z
      .object({
        nativeOverrides: z.array(identifier).max(32),
        navigatorOwnProperties: z.array(identifier).max(16),
        uaPlatformMismatch: z.boolean(),
        uaFeatureMismatch: z.boolean(),
        canvasNoise: z.boolean(),
      })
      .strict(),
    privacy: z
      .object({
        incognitoLikely: z.boolean(),
        incognitoMethod: identifier.nullable(),
        storageQuotaMb: z.number().finite().min(0).max(1e9).nullable(),
        braveLikely: z.boolean().optional(),
      })
      .strict(),
    storage: z.object({ cookie: z.boolean(), localStorage: z.boolean(), indexedDb: z.boolean() }).strict(),
    devtools: z.object({ likely: z.boolean(), method: identifier.nullable() }).strict().optional(),
    device: z.partialRecord(z.enum(DEVICE_COMPONENT_NAMES), z.string().regex(/^[0-9a-f]{8,64}$/)).optional(),
    env: z
      .object({
        engine: z.enum(['blink', 'gecko', 'webkit', 'unknown']),
        uaPlatformVersion: str(32).nullable(),
        uaArchitecture: str(16).nullable(),
        uaBitness: str(8).nullable(),
        uaModel: str(64).nullable(),
        uaFullVersion: str(32).nullable(),
        timerResolutionMs: z.number().finite().min(0).max(10_000).nullable(),
        permissions: z.string().regex(/^[gdp-]{0,16}$/).nullable(),
        cdp: z.boolean(),
        multiScreen: z.boolean().nullable(),
        gpc: z.boolean().nullable(),
        doNotTrack: z.boolean(),
        connectionRtt: z.number().finite().min(0).max(100_000).nullable().optional(),
        connectionType: str(8).nullable().optional(),
        framed: z.boolean().optional(),
        outerSize: z.string().max(24).regex(/^-?\d+x-?\d+$/).nullable().optional(),
        adBlock: z.boolean().nullable().optional(),
        extensionCount: z.number().int().min(0).max(1000).optional(),
      })
      .strict()
      .optional(),
    behavior: z
      .object({
        msSinceStart: z.number().int().min(0).max(1e10),
        pointerMoves: z.number().int().min(0).max(1e9),
        clicks: z.number().int().min(0).max(1e9),
        keys: z.number().int().min(0).max(1e9),
        scrolls: z.number().int().min(0).max(1e9),
        touches: z.number().int().min(0).max(1e9),
        untrusted: z.number().int().min(0).max(1e9),
        straightness: z.number().min(0).max(1).nullable(),
        keyIntervalStdMs: z.number().min(0).max(1e7).nullable(),
      })
      .strict()
      .optional(),
    consistency: z
      .object({
        workerMismatch: z.array(identifier).max(16).nullable(),
        iframeMismatch: z.array(identifier).max(16).nullable(),
        timezoneOffsetMismatch: z.boolean(),
      })
      .strict()
      .optional(),
    app: z
      .object({
        platform: z.enum(['ios', 'android']),
        osVersion: str(32).nullable(),
        manufacturer: str(64).nullable(),
        model: str(64).nullable(),
        appId: z.string().max(200).regex(/^[\w.-]*$/).nullable(),
        appVersion: str(32).nullable(),
        buildVersion: str(32).nullable(),
        isDevice: z.boolean().nullable(),
        rooted: z.boolean().nullable(),
        installedAt: z.number().int().min(0).max(1e13).nullable(),
      })
      .strict()
      .optional(),
    collectMs: z.number().finite().min(0).max(600_000),
  })
  .strict();

const tagValue = z.union([str(256), z.number().finite(), z.boolean()]);

export const identifyRequestSchema = z
  .object({
    signals,
    token: z.string().max(512).regex(/^[\w.-]+$/).optional(),
    tags: z
      .record(z.string().min(1).max(40).regex(/^[\w.-]+$/), tagValue)
      .refine((t) => Object.keys(t).length <= 10, 'At most 10 tags')
      .optional(),
    linkedId: z.string().min(1).max(256).regex(/^[\x20-\x7e]+$/).optional(),
    sdk: z.object({ name: str(64), version: str(32) }).strict(),
    via: z.object({ name: str(64), version: str(32) }).strict().optional(),
    sentAt: z.number().int().min(0).max(1e13).optional(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  })
  .strict();

export type ParsedIdentifyRequest = z.infer<typeof identifyRequestSchema>;

/** Error text names the offending field paths only; submitted values are never echoed. */
export function parseIdentifyRequest(body: unknown): { ok: true; value: ParsedIdentifyRequest } | { ok: false; message: string } {
  const result = identifyRequestSchema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  const paths = [...new Set(result.error.issues.slice(0, 5).map((i) => i.path.join('.') || '(root)'))];
  return { ok: false, message: `Invalid fields: ${paths.join(', ')}` };
}
