import {
  clientHintsMismatch,
  engineMismatch,
  fontOsMismatch,
  gpuOsMismatch,
  languageHeaderMismatch,
  uaVersionMismatch,
} from './antidetect.js';
import { DEFAULT_FLAGGED_NETWORK_CONFIG, DEFAULT_RARE_DEVICE_CONFIG, type ScoringConfig, type SignalId } from './config.js';
import { type BotInfo, classifyBot } from './agents.js';
import { checkPayloadIntegrity } from './integrity.js';
import { checkTimezoneCountry } from './timezones.js';
import { tlsMismatchReasons } from './tls.js';
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
    const headlessBrand = ctx.payload.attributes.uaBrands.some((x) => /headless/i.test(x.brand));
    // The DevTools protocol read a console argument: automation, or a person with DevTools open (hence weak, and
    // ignored when the devtools heuristic already saw open DevTools).
    const cdp = ctx.payload.env?.cdp === true && ctx.payload.devtools?.likely !== true;
    const attrs = ctx.payload.attributes;
    const desktop = !/Mobi|Android|iPhone|iPad/.test(attrs.userAgent ?? '');
    // Headless Chrome reports an 800x600 screen and, in older versions, a 0 ms connection round trip.
    const headlessScreen = desktop && attrs.screenWidth === 800 && attrs.screenHeight === 600;
    const zeroRtt = ctx.payload.env?.connectionRtt === 0 && ctx.payload.env.engine === 'blink' && desktop;
    const strong = b.webdriver || b.headlessUserAgent || headlessBrand || b.automationGlobals.length > 0 || headerMismatch;
    const weak = [b.noPlugins, b.noLanguages, b.permissionsInconsistent, b.chromeObjectMissing, b.zeroOuterSize, cdp, headlessScreen, zeroRtt].filter(
      Boolean,
    ).length;
    return {
      detected: strong || weak >= 2,
      details: {
        webdriver: b.webdriver,
        headlessUserAgent: b.headlessUserAgent,
        automationGlobals: b.automationGlobals,
        userAgentHeaderMismatch: headerMismatch,
        headlessBrand,
        devtoolsProtocol: cdp,
        headlessScreen,
        zeroRtt,
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
    const anomalyScore = tamperingAnomalyScore(ctx);
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
        anomalyScore,
      },
    };
  },
};

/**
 * 0-1: how far this browser is from an unmodified one, combining every self-contradiction found (noisy-OR, so each
 * independent finding raises the score and none can push it past 1). Weights reflect how rarely each finding occurs
 * on unmodified browsers.
 */
export function tamperingAnomalyScore(ctx: EvaluationContext): number {
  const t = ctx.payload.tamper;
  const c = ctx.payload.consistency;
  const a = ctx.payload.attributes;
  const findings: number[] = [];
  for (let i = 0; i < Math.min(t.nativeOverrides.length, 3); i++) findings.push(0.3);
  if (t.navigatorOwnProperties.length > 0) findings.push(0.35);
  if (t.uaPlatformMismatch) findings.push(0.4);
  if (t.uaFeatureMismatch) findings.push(0.35);
  if (t.canvasNoise) findings.push(0.1);
  if (c?.workerMismatch?.length) findings.push(0.45);
  if (c?.iframeMismatch?.length) findings.push(0.4);
  if (c?.timezoneOffsetMismatch) findings.push(0.3);
  if (gpuOsMismatch(a.userAgent, a.webglRenderer)) findings.push(0.4);
  if (fontOsMismatch(a.userAgent, ctx.payload.device?.fontsMask)) findings.push(0.3);
  if (clientHintsMismatch(ctx.headers.secChUaPlatform, a.userAgent)) findings.push(0.45);
  if (engineMismatch(ctx.payload.env, a.userAgent)) findings.push(0.6);
  if (uaVersionMismatch(ctx.payload.env, a.userAgent)) findings.push(0.45);
  if (languageHeaderMismatch(ctx.headers.acceptLanguage, a.languages)) findings.push(0.35);
  const clean = findings.reduce((p, w) => p * (1 - w), 1);
  return Math.round((1 - clean) * 100) / 100;
}

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
    const over = (n: number | null | undefined, limit: number) => typeof n === 'number' && n > limit;
    if (over(v.eventsPerVisitor5m, t.eventsPerVisitor5m)) exceeded.push('eventsPerVisitor5m');
    if (over(v.countriesPerVisitor24h, t.countriesPerVisitor24h)) exceeded.push('countriesPerVisitor24h');
    if (over(v.linkedIdsPerVisitor24h, t.linkedIdsPerVisitor24h)) exceeded.push('linkedIdsPerVisitor24h');
    return {
      detected: exceeded.length > 0,
      details: {
        available: true,
        exceeded,
        eventsPerVisitor1h: v.eventsPerVisitor1h,
        visitorsPerIp1h: v.visitorsPerIp1h,
        ipsPerVisitor24h: v.ipsPerVisitor24h,
        visitorsPerLinkedId24h: v.visitorsPerLinkedId24h,
        eventsPerVisitor5m: v.eventsPerVisitor5m ?? null,
        countriesPerVisitor24h: v.countriesPerVisitor24h ?? null,
        linkedIdsPerVisitor24h: v.linkedIdsPerVisitor24h ?? null,
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

const devtools: SignalDefinition = {
  id: 'devtools',
  title: 'Developer tools open',
  description: 'The browser window is much larger than its viewport, the usual footprint of docked developer tools.',
  falsePositives:
    'Browser sidebars, zoom levels and some window managers create the same gap; undocked devtools are not detected. Weak by design; mostly useful together with other signals.',
  evaluate(ctx) {
    const d = ctx.payload.devtools;
    return { detected: d?.likely === true, details: { method: d?.method ?? null, reported: d !== undefined } };
  },
};

/** GPU renderer strings of hypervisors and software rasterizers. */
const VM_RENDERERS = /vmware|virtualbox|vbox|svga3d|parallels|qemu|virgl|red hat|hyper-v|microsoft basic render|llvmpipe|softpipe|swiftshader/i;

const virtualMachine: SignalDefinition = {
  id: 'virtualMachine',
  title: 'Virtual machine',
  description:
    'The WebGL renderer is a hypervisor display adapter (VMware, VirtualBox, Parallels, QEMU/virgl, Hyper-V) or a software rasterizer (llvmpipe, SwiftShader).',
  falsePositives:
    'Remote desktops, some thin clients, Linux machines without GPU drivers, and browsers with hardware acceleration turned off report software renderers.',
  evaluate(ctx) {
    const renderer = ctx.payload.attributes.webglRenderer;
    const match = renderer ? VM_RENDERERS.exec(renderer) : null;
    return { detected: match !== null, details: { renderer: renderer ?? null, matched: match?.[0].toLowerCase() ?? null } };
  },
};

function looksLikeTorBrowser(ctx: EvaluationContext): boolean {
  const a = ctx.payload.attributes;
  const firefox = /Firefox\//.test(a.userAgent ?? '') && !/Seamonkey/i.test(a.userAgent ?? '');
  const utc = a.timezone === 'UTC' || a.timezone === 'Etc/UTC';
  // Letterboxing rounds the content area to multiples of 200x100.
  const letterboxed =
    a.availWidth !== null && a.availHeight !== null && a.availWidth % 200 === 0 && a.availHeight % 100 === 0;
  return firefox && utc && letterboxed;
}

const privacyBrowser: SignalDefinition = {
  id: 'privacyBrowser',
  title: 'Privacy-focused browser',
  description:
    'Brave, Tor Browser or Mullvad Browser (Firefox with UTC timezone and letterboxing), DuckDuckGo, or any browser that randomises canvas output.',
  falsePositives:
    'These are legitimate choices by privacy-conscious people. Use it to explain lower identification confidence, not to block.',
  evaluate(ctx) {
    const ua = ctx.payload.attributes.userAgent ?? '';
    const reasons: string[] = [];
    if (ctx.payload.privacy.braveLikely) reasons.push('brave');
    if (looksLikeTorBrowser(ctx)) reasons.push('torOrMullvad');
    if (/DuckDuckGo\/|Ddg\//.test(ua)) reasons.push('duckduckgo');
    if (ctx.payload.tamper.canvasNoise) reasons.push('canvasNoise');
    // Tor Browser and Firefox resistFingerprinting coarsen timers to 16-100 ms; normal browsers stay at or below 1 ms.
    const timer = ctx.payload.env?.timerResolutionMs;
    if (typeof timer === 'number' && timer >= 16) reasons.push('coarseTimer');
    return { detected: reasons.length > 0, details: { reasons } };
  },
};

const highActivity: SignalDefinition = {
  id: 'highActivity',
  title: 'High-activity device',
  description: 'One visitor produced more events in the last 24 hours than the configured threshold.',
  falsePositives:
    'Shared kiosks, QA machines and power users of single-page apps that identify on every route change. Identify on meaningful actions, not every page view.',
  evaluate(ctx, config): SignalResult {
    const n = ctx.velocity?.eventsPerVisitor24h ?? null;
    if (n === null) return { detected: false, details: { available: false } };
    return {
      detected: n > config.velocity.eventsPerVisitor24h,
      details: { available: true, eventsPerVisitor24h: n, threshold: config.velocity.eventsPerVisitor24h },
    };
  },
};

const crossBrowser: SignalDefinition = {
  id: 'crossBrowser',
  title: 'Same device, other browser',
  description:
    'Another visitor in a different browser or browser profile matches this device on hardware and OS traits (GPU, screen, CPU, fonts, speech voices, display preferences, keyboard, clock, timezone) and shares a network with it, now or within the window. Typical of one person opening a second browser to create another account.',
  falsePositives:
    'Families and offices that share one network and own identical computers (same model, same OS image, same fonts) look like one device in two browsers. Cross-network links (rare hardware only) stay below the threshold of this signal for this reason. Treat it as "probably the same person", and look at linkedVisitors before acting.',
  evaluate(ctx, config): SignalResult {
    const link = ctx.crossBrowser;
    if (!link) return { detected: false, details: { available: false } };
    return {
      detected: link.linkedCount > 0 && link.topConfidence >= config.crossBrowser.signalThreshold,
      details: {
        available: true,
        linkedVisitors: link.linkedCount,
        topConfidence: link.topConfidence,
        browsers: link.browsers,
        threshold: config.crossBrowser.signalThreshold,
      },
    };
  },
};

const antiDetect: SignalDefinition = {
  id: 'antiDetect',
  title: 'Anti-detect browser',
  description:
    'The browser contradicts itself: a Web Worker or a fresh iframe reports another user agent, language, CPU count, time zone or GPU than the page; the clock offset does not fit the claimed time zone; or the GPU or the installed fonts belong to another operating system than the user agent claims. Typical of anti-detect browsers (Multilogin, GoLogin, AdsPower, Dolphin and similar) that give every profile a made-up device, the usual tool for running many accounts.',
  falsePositives:
    'User-agent switcher extensions and DevTools device emulation (a phone user agent on a desktop GPU) trigger it, as does a time zone changed while the page was open. Brave randomises the CPU count, so that one reading is ignored for Brave.',
  evaluate(ctx) {
    const c = ctx.payload.consistency;
    const a = ctx.payload.attributes;
    const brave = ctx.payload.privacy.braveLikely === true;
    const keep = (list: string[] | null | undefined): string[] =>
      (list ?? []).filter((f) => !(brave && f === 'hardwareConcurrency'));
    const worker = keep(c?.workerMismatch);
    const iframe = keep(c?.iframeMismatch);
    const gpu = gpuOsMismatch(a.userAgent, a.webglRenderer);
    const fonts = fontOsMismatch(a.userAgent, ctx.payload.device?.fontsMask);
    const hints = clientHintsMismatch(ctx.headers.secChUaPlatform, a.userAgent);
    const engine = engineMismatch(ctx.payload.env, a.userAgent);
    const version = uaVersionMismatch(ctx.payload.env, a.userAgent);
    const language = languageHeaderMismatch(ctx.headers.acceptLanguage, a.languages);
    const reasons: string[] = [];
    if (worker.length > 0) reasons.push('workerMismatch');
    if (iframe.length > 0) reasons.push('iframeMismatch');
    if (c?.timezoneOffsetMismatch) reasons.push('timezoneOffsetMismatch');
    if (gpu) reasons.push(gpu);
    if (fonts) reasons.push(fonts);
    if (hints) reasons.push(hints);
    if (engine) reasons.push(engine);
    if (version) reasons.push(version);
    if (language) reasons.push(language);
    return {
      detected: reasons.length > 0,
      details: {
        reasons,
        workerMismatch: worker,
        iframeMismatch: iframe,
        workerChecked: Array.isArray(c?.workerMismatch),
      },
    };
  },
};

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const vpn: SignalDefinition = {
  id: 'vpn',
  title: 'VPN / proxy',
  description:
    'Methods, any of which fires the signal: timezoneMismatch (no zone of the IP country has the device UTC offset right now; needs GEOIP_COUNTRY_DB), publicVpn (the IP is in an operator-supplied VPN range or VPN-provider ASN list). Privacy relays such as iCloud Private Relay are reported as relay but do not fire it. Catches VPNs and proxies, residential ones included, that exit in another region.',
  falsePositives:
    'Travellers who keep their home time zone, people near a border on a foreign mobile network, and stale GeoIP data. Devices set to UTC (Tor Browser, Firefox resistFingerprinting, servers) are not judged by time zone. Neighbouring countries in one offset (a VPN from Berlin to Paris) are missed by the time-zone method.',
  evaluate(ctx): SignalResult {
    const timezone = ctx.payload.attributes.timezone;
    const check = checkTimezoneCountry(timezone, ctx.ip.country, ctx.now ?? new Date());
    const listed = ctx.ip.vpn === true;
    const relay = ctx.ip.relay === true;
    const methods: string[] = [];
    if (check.status === 'mismatch') methods.push('timezoneMismatch');
    if (listed) methods.push('publicVpn');
    const tz: SignalDetails =
      check.status === 'unknown'
        ? { timezoneCheck: check.reason }
        : {
            timezoneCheck: check.status,
            deviceOffset: formatOffset(check.offsetMinutes),
            countryOffsets: check.countryOffsets.map(formatOffset),
          };
    const available = check.status !== 'unknown' || ctx.ip.vpn !== undefined;
    return {
      detected: methods.length > 0,
      details: { available, methods, relay, ipCountry: ctx.ip.country, timezone, ...tz },
    };
  },
};

const tlsMismatch: SignalDefinition = {
  id: 'tlsMismatch',
  title: 'TLS client mismatch',
  description:
    'The TLS handshake (JA4 fingerprint, supplied by a trusted proxy) does not fit the browser the user agent claims: no TLS 1.3, no SNI, or no HTTP/2 offer, which every current browser sends. Also fires for fingerprints on the operator-supplied JA4 blocklist. Catches scripts and HTTP libraries that copy a browser user agent.',
  falsePositives:
    'Corporate TLS-inspecting proxies re-terminate TLS with their own client, so every user behind one looks the same; allow their egress IPs or turn the header off for them. Very old browsers fail the TLS 1.3 test.',
  evaluate(ctx): SignalResult {
    const tls = ctx.tls;
    if (!tls) return { detected: false, details: { available: false } };
    const reasons = tlsMismatchReasons(tls.ja4, ctx.headers.userAgent ?? ctx.payload.attributes.userAgent, tls.blocklisted);
    return { detected: reasons.length > 0, details: { available: true, ja4: tls.ja4, reasons } };
  },
};

const multiAccount: SignalDefinition = {
  id: 'multiAccount',
  title: 'Many accounts on one device',
  description:
    'More distinct accounts (linkedId) than the threshold used this device (deviceId, across its browsers) within the window. The classic pattern of signup abuse, ban evasion and promotion farming.',
  falsePositives:
    'Shared family computers, internet cafes, support staff who sign in as customers, and QA machines. Only counts accounts that the integration passes as linkedId.',
  evaluate(ctx, config): SignalResult {
    const acc = ctx.accounts;
    if (!acc) return { detected: false, details: { available: false } };
    return {
      detected: acc.accountsOnDevice > config.accounts.maxAccountsPerDevice,
      details: { available: true, accountsOnDevice: acc.accountsOnDevice, threshold: config.accounts.maxAccountsPerDevice },
    };
  },
};

const accountSharing: SignalDefinition = {
  id: 'accountSharing',
  title: 'Account used on many devices',
  description:
    'One account (linkedId) was used on more distinct devices than the threshold within the window: credential sharing, a sold or stolen account, or credential stuffing that succeeded.',
  falsePositives:
    'People with many devices (phone, tablet, work and home computers), devices that were reinstalled, and privacy browsers that look like a new device on every visit. Raise maxDevicesPerAccount for such audiences.',
  evaluate(ctx, config): SignalResult {
    const n = ctx.accounts?.devicesForAccount ?? null;
    if (n === null) return { detected: false, details: { available: false } };
    return {
      detected: n > config.accounts.maxDevicesPerAccount,
      details: { available: true, devicesForAccount: n, threshold: config.accounts.maxDevicesPerAccount },
    };
  },
};

const automatedInput: SignalDefinition = {
  id: 'automatedInput',
  title: 'Automated input',
  description:
    'Input between SDK start and identify that no person produces: pointer, click, key or touch events created by page scripts (isTrusted false), a ruler-straight pointer path over 20 or more moves, or key presses at machine-regular intervals (standard deviation under 3 ms over 9 or more keys). Catches bots that drive the page with scripted events, including through browser automation that bypasses webdriver flags.',
  falsePositives:
    'Sites whose own code dispatches synthetic clicks or key events (some UI libraries and test harnesses), and some accessibility and remote-control tools. Password managers fill fields without key presses and are not affected.',
  evaluate(ctx): SignalResult {
    const b = ctx.payload.behavior;
    if (!b) return { detected: false, details: { available: false } };
    const reasons: string[] = [];
    if (b.untrusted > 0) reasons.push('syntheticEvents');
    if (b.straightness !== null && b.straightness >= 0.999) reasons.push('linearPointer');
    if (b.keyIntervalStdMs !== null && b.keyIntervalStdMs < 3) reasons.push('robotTyping');
    return {
      detected: reasons.length > 0,
      details: {
        available: true,
        reasons,
        pointerMoves: b.pointerMoves,
        clicks: b.clicks,
        keys: b.keys,
        untrusted: b.untrusted,
        straightness: b.straightness,
        keyIntervalStdMs: b.keyIntervalStdMs,
        msSinceStart: b.msSinceStart,
      },
    };
  },
};

/** The bot verdict for an event: good, bad or none, with the bot's type and name when known. */
export function botInfo(ctx: EvaluationContext, botDetected: boolean): BotInfo {
  const b = ctx.payload.bot;
  return classifyBot({
    userAgent: ctx.headers.userAgent ?? ctx.payload.attributes.userAgent,
    automationDetected: botDetected,
    automationGlobals: b.automationGlobals,
    webdriver: b.webdriver,
    headlessUserAgent: b.headlessUserAgent,
    signedAgent: ctx.signedAgent ?? null,
    crawlerVerified: ctx.crawlerVerified ?? null,
  });
}

const tamperedRequest: SignalDefinition = {
  id: 'tamperedRequest',
  title: 'Tampered request',
  description:
    "The identify payload contradicts itself: readable attributes (screen, time zone, languages, platform, GPU, hardware) do not hash to the payload's own components. The SDK derives both from one reading, so a mismatch means the payload was edited after collection or built by hand, typically to spoof a device.",
  falsePositives:
    'An unmodified SDK never produces a mismatch. A self-built or patched SDK that changes how a component is derived will, until this check is updated with it.',
  evaluate(ctx) {
    const r = checkPayloadIntegrity(ctx.payload);
    return { detected: r.mismatched.length > 0, details: { checked: r.checked, mismatched: r.mismatched } };
  },
};

const emulator: SignalDefinition = {
  id: 'emulator',
  title: 'Emulator',
  description:
    'A native app running on an emulator or simulator instead of a physical device (React Native SDK, expo-device isDevice). Emulators are cheap to clone and reset, so farms of fake devices run on them.',
  falsePositives:
    'Developers and QA testing your app. Use a separate key for development builds, or tag those events, so test traffic does not train or trip your rules.',
  evaluate(ctx): SignalResult {
    const app = ctx.payload.app;
    if (!app) return { detected: false, details: { available: false } };
    return { detected: app.isDevice === false, details: { available: app.isDevice !== null, platform: app.platform, model: app.model } };
  },
};

const rootedDevice: SignalDefinition = {
  id: 'rootedDevice',
  title: 'Rooted or jailbroken device',
  description:
    "A native app on a rooted Android or jailbroken iOS device (React Native SDK, expo-device's root and jailbreak heuristics: su binaries, Cydia and similar paths, writable system locations). Root makes it easy to hook the app, fake GPS and readings, and clone installs.",
  falsePositives:
    'Enthusiasts root their phones for legitimate reasons, and some custom ROMs look rooted. The checks are heuristics: hiding tools (Magisk DenyList and the like) can defeat them, so a clean result is not proof.',
  evaluate(ctx): SignalResult {
    const app = ctx.payload.app;
    if (!app) return { detected: false, details: { available: false } };
    return { detected: app.rooted === true, details: { available: app.rooted !== null, platform: app.platform } };
  },
};

const flaggedNetwork: SignalDefinition = {
  id: 'flaggedNetwork',
  title: 'Flagged network',
  description:
    'Other visitors on the same IP network (the /24 or /64 that cross-browser linking keys) were flagged recently: at least minFlagged of them scored flagScore or more in the last windowHours, and they are at least minShare of the visitors seen there. Device farms and fraud rings work from shared networks. A neighbour\'s own flaggedNetwork points are not counted, so it cannot spread from visitor to visitor.',
  falsePositives:
    'A legitimate visitor on a network a fraud ring also uses (a small office, a hotel, a cafe, a shared residential proxy exit). The share rule keeps mobile carriers and large offices, where a few flagged visitors are a small fraction, from firing. Needs cross-browser linking on (it reuses the keyed network hash).',
  evaluate(ctx, config): SignalResult {
    const n = ctx.network;
    const c = config.flaggedNetwork ?? DEFAULT_FLAGGED_NETWORK_CONFIG;
    if (!n) return { detected: false, details: { available: false } };
    const share = n.visitors > 0 ? n.flagged / n.visitors : 0;
    return {
      detected: n.flagged >= c.minFlagged && share >= c.minShare,
      details: { available: true, visitors: n.visitors, flagged: n.flagged, share: Math.round(share * 100) / 100, minFlagged: c.minFlagged },
    };
  },
};

const replayedRequest: SignalDefinition = {
  id: 'replayedRequest',
  title: 'Replayed request',
  description:
    'The identify request carries a nonce Trace has already seen: the same request was sent again. Typically a request captured from a real browser and re-sent by a script, so a bot inherits a clean device. The SDK draws a new random nonce for every call. Anything a client sends can be edited, so this catches verbatim replays; an attacker who also rewrites the payload is left to tamperedRequest and the other signals.',
  falsePositives:
    'The SDK never reuses a nonce and never retries a request on its own. A proxy, browser extension or service worker that re-sends the same request body would be counted. Nonces are kept for 24 hours, so a replay after that is not caught.',
  evaluate(ctx): SignalResult {
    const r = ctx.replay;
    if (!r) return { detected: false, details: { available: false } };
    return { detected: r.nonceSeen, details: { available: true, sentAgoMs: r.sentAgoMs } };
  },
};

const proxy: SignalDefinition = {
  id: 'proxy',
  title: 'Proxy',
  description:
    'Request IP is on an operator-supplied proxy list (PROXY_CIDR_FILE): residential or datacenter proxy exits rented to hide where traffic comes from.',
  falsePositives:
    'Residential proxy networks run on ordinary home connections, often without the owner knowing; a household that shares an exit can be listed. Lists go stale quickly, so keep them current.',
  evaluate(ctx) {
    return { detected: ctx.ip.proxy === true, details: { available: ctx.ip.proxy !== undefined, asn: ctx.ip.asn, asnOrg: ctx.ip.asnOrg } };
  },
};

const rareDevice: SignalDefinition = {
  id: 'rareDevice',
  title: 'Rare device',
  description:
    "The device's GPU, screen, hardware and platform combine into something very few of this project's visitors have. Rare setups are typical of emulators, custom builds and spoofed hardware. Judged only once the project has enough visitors.",
  falsePositives:
    'New hardware, unusual monitors and niche platforms are rare without being risky, and a young or small project has thin statistics. The estimate treats components as independent, which overstates rarity for values that usually go together.',
  evaluate(ctx, config): SignalResult {
    const cfg = config.rareDevice ?? DEFAULT_RARE_DEVICE_CONFIG;
    const r = ctx.rarity;
    if (!r || r.total < cfg.minVisitors) {
      return { detected: false, details: { available: false, visitors: r?.total ?? null, minVisitors: cfg.minVisitors } };
    }
    return {
      detected: r.share < cfg.maxShare,
      details: {
        available: true,
        visitors: r.total,
        share: Number(r.share.toPrecision(3)),
        maxShare: cfg.maxShare,
        rarest: Object.entries(r.components).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null,
      },
    };
  },
};

const aiAgent: SignalDefinition = {
  id: 'aiAgent',
  title: 'AI agent',
  description:
    'An AI assistant or agent acting for a person (ChatGPT, Claude, Perplexity and others) that did not prove its identity with a Web Bot Auth signature or by coming from the published IP ranges of its operator. Signed and range-verified agents are reported in botInfo (identity "signed" or "verified") and do not fire this signal.',
  falsePositives:
    'People use assistants for legitimate tasks, so treat this as a reason to step up, not to block outright. Detection reads the declared user agent: agents that drive an ordinary browser without declaring themselves are only caught by the bot and automatedInput signals.',
  evaluate(ctx) {
    const info = classifyBot({
      userAgent: ctx.headers.userAgent ?? ctx.payload.attributes.userAgent,
      automationDetected: false,
      automationGlobals: [],
      webdriver: false,
      headlessUserAgent: false,
      signedAgent: ctx.signedAgent ?? null,
      crawlerVerified: ctx.crawlerVerified ?? null,
    });
    const isAgent = info.type === 'aiAgent';
    const s = ctx.signedAgent;
    return {
      detected: isAgent && info.identity === 'unsigned',
      details: {
        name: isAgent ? info.name : null,
        provider: isAgent ? info.provider : null,
        identity: isAgent ? info.identity : null,
        signatureAgent: s ? s.agent : null,
        signatureVerified: s ? s.verified : null,
        signatureError: s && !s.verified ? (s.reason ?? 'unverified') : null,
      },
    };
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
  devtools,
  virtualMachine,
  privacyBrowser,
  highActivity,
  crossBrowser,
  antiDetect,
  vpn,
  tlsMismatch,
  multiAccount,
  accountSharing,
  automatedInput,
  aiAgent,
  proxy,
  rareDevice,
  tamperedRequest, replayedRequest, flaggedNetwork, emulator, rootedDevice,
];

export type SignalResults = Record<SignalId, SignalResult>;

export function evaluateSignals(ctx: EvaluationContext, config: ScoringConfig): SignalResults {
  const results = {} as SignalResults;
  for (const def of SIGNAL_DEFINITIONS) {
    results[def.id] = def.evaluate(ctx, config);
  }
  return results;
}
