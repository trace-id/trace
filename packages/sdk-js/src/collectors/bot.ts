import { type BotIndicators } from '@tbdname/signals/types';
import { safe, safeAsync } from './safe.js';
import { browserFamily } from './ua.js';

const AUTOMATION_GLOBALS = [
  '__nightmare',
  '_phantom',
  'callPhantom',
  '__selenium_unwrapped',
  '__webdriver_evaluate',
  '__driver_evaluate',
  '__webdriver_script_fn',
  '__fxdriver_unwrapped',
  '_Selenium_IDE_Recorder',
  'domAutomation',
  'domAutomationController',
  '__playwright__binding__',
  '__pwInitScripts',
  '__puppeteer_evaluation_script__',
  'cdc_adoQpoasnfa76pfcZLmcfl_Array',
  'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
  'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
];

const DOCUMENT_MARKERS = ['__webdriver_script_fn', '__selenium_evaluate', '__driver_unwrapped', '$cdc_asdjflasutopfhvcZLmcfl_'];

async function permissionsInconsistent(): Promise<boolean> {
  if (typeof Notification === 'undefined' || !navigator.permissions?.query) return false;
  const status = await navigator.permissions.query({ name: 'notifications' as PermissionName });
  return Notification.permission === 'denied' && status.state === 'prompt';
}

export async function readBotIndicators(timeoutMs: number): Promise<BotIndicators> {
  const ua = safe(() => navigator.userAgent, '');
  const isChromium = browserFamily(ua) === 'chrome' || browserFamily(ua) === 'edge';
  const isMobile = /Mobi|Android|iPhone|iPad/.test(ua);
  const w = window as unknown as Record<string, unknown>;
  const d = document as unknown as Record<string, unknown>;
  return {
    webdriver: safe(() => navigator.webdriver === true, false),
    headlessUserAgent: /HeadlessChrome|PhantomJS|SlimerJS/.test(ua),
    automationGlobals: safe(
      () => [...AUTOMATION_GLOBALS.filter((k) => k in w), ...DOCUMENT_MARKERS.filter((k) => k in d)],
      [],
    ),
    noPlugins: safe(() => isChromium && !isMobile && navigator.plugins.length === 0, false),
    noLanguages: safe(() => !navigator.languages || navigator.languages.length === 0, false),
    permissionsInconsistent: await safeAsync(permissionsInconsistent, false, timeoutMs),
    chromeObjectMissing: safe(() => isChromium && !isMobile && !('chrome' in w), false),
    zeroOuterSize: safe(() => window.outerWidth === 0 && window.outerHeight === 0, false),
  };
}
