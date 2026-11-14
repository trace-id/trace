import { COMPONENT_NAMES } from '@tbdname/signals/types';
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
      })
      .strict(),
    storage: z.object({ cookie: z.boolean(), localStorage: z.boolean(), indexedDb: z.boolean() }).strict(),
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
