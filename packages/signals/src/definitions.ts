import { type ScoringConfig, type SignalId } from './config.js';
import { type EvaluationContext } from './types.js';

export type SignalDetails = Record<string, string | number | boolean | string[] | null>;

export interface SignalResult {
  detected: boolean;
  details: SignalDetails;
}

export interface SignalDefinition {
  id: SignalId;
  title: string;
  description: string;
  falsePositives: string;
  evaluate(ctx: EvaluationContext, config: ScoringConfig): SignalResult;
}

function normalizeUa(ua: string | null): string | null {
  return ua === null ? null : ua.trim();
}

const bot: SignalDefinition = {
  id: 'bot',
  title: 'Bot / automation',
  description:
    'Headless browser or automation framework (Puppeteer, Playwright, Selenium) detected from client indicators and header consistency.',
  falsePositives:
    'Accessibility tools and some privacy extensions remove plugins or patch navigator; such users can trip weak indicators. Strong indicators (webdriver flag, automation globals, HeadlessChrome UA, UA header mismatch) are rarely wrong; two weak indicators are required otherwise.',
  evaluate(ctx) {
    const b = ctx.payload.bot;
    const headerUa = normalizeUa(ctx.headers.userAgent);
    const payloadUa = normalizeUa(ctx.payload.attributes.userAgent);
    const headerMismatch = headerUa !== null && payloadUa !== null && headerUa !== payloadUa;
    const strong = b.webdriver || b.headlessUserAgent || b.automationGlobals.length > 0 || headerMismatch;
    const weak = [b.noPlugins, b.noLanguages, b.permissionsInconsistent, b.chromeObjectMissing, b.zeroOuterSize].filter(
      Boolean,
    ).length;
    return {
      detected: strong || weak >= 2,
      details: {
        webdriver: b.webdriver,
        headlessUserAgent: b.headlessUserAgent,
        automationGlobals: b.automationGlobals,
        userAgentHeaderMismatch: headerMismatch,
        weakIndicatorCount: weak,
      },
    };
  },
};

const tampering: SignalDefinition = {
  id: 'tampering',
  title: 'Browser tampering',
  description:
    'Native browser APIs overridden, navigator properties shadowed, or the claimed user agent does not match the real platform/feature set.',
  falsePositives:
    'Anti-fingerprinting extensions (and Brave farbling, which shows up as canvas noise) trigger this by design. Treat it as "this browser lies about itself", not as fraud on its own.',
  evaluate(ctx) {
    const t = ctx.payload.tamper;
    const detected =
      t.nativeOverrides.length > 0 ||
      t.navigatorOwnProperties.length > 0 ||
      t.uaPlatformMismatch ||
      t.uaFeatureMismatch;
    return {
      detected,
      details: {
        nativeOverrides: t.nativeOverrides,
        navigatorOwnProperties: t.navigatorOwnProperties,
        uaPlatformMismatch: t.uaPlatformMismatch,
        uaFeatureMismatch: t.uaFeatureMismatch,
        canvasNoise: t.canvasNoise,
      },
    };
  },
};

const tor: SignalDefinition = {
  id: 'tor',
  title: 'Tor exit node',
  description: 'Request IP appears in the operator-supplied Tor exit list.',
  falsePositives: 'Exit lists lag reality by minutes to hours; a recycled IP may be flagged after it stopped being an exit.',
  evaluate(ctx) {
    return { detected: ctx.ip.tor, details: {} };
  },
};

const datacenterIp: SignalDefinition = {
  id: 'datacenterIp',
  title: 'Datacenter / hosting IP',
  description:
    'Request IP falls in an operator-supplied datacenter or hosting CIDR list. Most commercial VPNs and proxies exit from such ranges.',
  falsePositives:
    'Corporate egress through cloud security gateways (Zscaler and similar) and iCloud Private Relay can originate from hosting ranges.',
  evaluate(ctx) {
    return { detected: ctx.ip.datacenter, details: { asn: ctx.ip.asn, asnOrg: ctx.ip.asnOrg } };
  },
};

const ipBlocklist: SignalDefinition = {
  id: 'ipBlocklist',
  title: 'IP blocklist',
  description: 'Request IP matches an operator-supplied blocklist.',
  falsePositives: 'Shared IPs (CGNAT, mobile carriers, universities) can put innocent users on a list built from one bad actor.',
  evaluate(ctx) {
    return { detected: ctx.ip.blocklisted, details: {} };
  },
};

const velocity: SignalDefinition = {
  id: 'velocity',
  title: 'Velocity',
  description:
    'Unusual activity rates: events per visitor, distinct visitors per IP, distinct IPs per visitor, distinct visitors per linkedId.',
  falsePositives:
    'Offices, schools and mobile carriers put many real visitors behind one IP. Raise visitorsPerIp1h for audiences behind CGNAT.',
  evaluate(ctx, config): SignalResult {
    const v = ctx.velocity;
    if (v === null) return { detected: false, details: { available: false } };
    const t = config.velocity;
    const exceeded: string[] = [];
    if (v.eventsPerVisitor1h !== null && v.eventsPerVisitor1h > t.eventsPerVisitor1h) exceeded.push('eventsPerVisitor1h');
    if (v.visitorsPerIp1h !== null && v.visitorsPerIp1h > t.visitorsPerIp1h) exceeded.push('visitorsPerIp1h');
    if (v.ipsPerVisitor24h !== null && v.ipsPerVisitor24h > t.ipsPerVisitor24h) exceeded.push('ipsPerVisitor24h');
    if (v.visitorsPerLinkedId24h !== null && v.visitorsPerLinkedId24h > t.visitorsPerLinkedId24h) {
      exceeded.push('visitorsPerLinkedId24h');
    }
    return {
      detected: exceeded.length > 0,
      details: {
        available: true,
        exceeded,
        eventsPerVisitor1h: v.eventsPerVisitor1h,
        visitorsPerIp1h: v.visitorsPerIp1h,
        ipsPerVisitor24h: v.ipsPerVisitor24h,
        visitorsPerLinkedId24h: v.visitorsPerLinkedId24h,
      },
    };
  },
};

const incognito: SignalDefinition = {
  id: 'incognito',
  title: 'Incognito / private mode',
  description: 'Client heuristics (storage quota vs heap limit, service worker or OPFS availability) suggest a private window.',
  falsePositives:
    'Low-disk devices get small storage quotas and can look private; browsers change these behaviours between releases. Low weight by default.',
  evaluate(ctx) {
    const p = ctx.payload.privacy;
    return { detected: p.incognitoLikely, details: { method: p.incognitoMethod } };
  },
};

export const SIGNAL_DEFINITIONS: readonly SignalDefinition[] = [
  bot,
  tampering,
  tor,
  datacenterIp,
  ipBlocklist,
  velocity,
  incognito,
];

export type SignalResults = Record<SignalId, SignalResult>;

export function evaluateSignals(ctx: EvaluationContext, config: ScoringConfig): SignalResults {
  const results = {} as SignalResults;
  for (const def of SIGNAL_DEFINITIONS) {
    results[def.id] = def.evaluate(ctx, config);
  }
  return results;
}
