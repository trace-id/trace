export type DeviceKind = 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown';

export interface ParsedUa {
  browser: string;
  browserVersion: string | null;
  os: string;
  osVersion: string | null;
  deviceKind: DeviceKind;
  /** Handset or tablet model when the user agent names one (mostly Android). */
  model: string | null;
  engine: string | null;
}

const WIN: Record<string, string> = { '10.0': '10 / 11', '6.3': '8.1', '6.2': '8', '6.1': '7' };

/** Reads what a user agent claims. It is a claim: the server cross-checks it, and spoofed agents are caught by signals. */
export function parseUa(ua: string | null | undefined): ParsedUa {
  if (!ua) return { browser: 'Unknown', browserVersion: null, os: 'Unknown', osVersion: null, deviceKind: 'Unknown', model: null, engine: null };
  const m = (re: RegExp) => re.exec(ua)?.[1] ?? null;
  const headless = /Headless/i.test(ua);

  let browser = 'Unknown';
  let browserVersion: string | null = null;
  if (headless) [browser, browserVersion] = ['Headless Chrome', m(/HeadlessChrome\/([\d.]+)/)];
  else if (/Edg(e|A|iOS)?\//.test(ua)) [browser, browserVersion] = ['Edge', m(/Edg(?:e|A|iOS)?\/([\d.]+)/)];
  else if (/OPR\/|Opera/.test(ua)) [browser, browserVersion] = ['Opera', m(/OPR\/([\d.]+)/)];
  else if (/SamsungBrowser\//.test(ua)) [browser, browserVersion] = ['Samsung Internet', m(/SamsungBrowser\/([\d.]+)/)];
  else if (/Vivaldi\//.test(ua)) [browser, browserVersion] = ['Vivaldi', m(/Vivaldi\/([\d.]+)/)];
  else if (/Firefox\/|FxiOS\//.test(ua)) [browser, browserVersion] = ['Firefox', m(/(?:Firefox|FxiOS)\/([\d.]+)/)];
  else if (/Chrome\/|CriOS\//.test(ua)) [browser, browserVersion] = ['Chrome', m(/(?:Chrome|CriOS)\/([\d.]+)/)];
  else if (/Safari\//.test(ua)) [browser, browserVersion] = ['Safari', m(/Version\/([\d.]+)/)];

  let os = 'Unknown';
  let osVersion: string | null = null;
  const win = m(/Windows NT ([\d.]+)/);
  const ios = /iPhone|iPad|iPod/.test(ua);
  if (win) [os, osVersion] = ['Windows', WIN[win] ?? win];
  else if (ios) [os, osVersion] = ['iOS', (m(/OS (\d+[_\d]*)/) ?? '').replace(/_/g, '.') || null];
  else if (/Android/.test(ua)) [os, osVersion] = ['Android', m(/Android ([\d.]+)/)];
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';

  let deviceKind: DeviceKind;
  if (headless || /bot|crawler|spider/i.test(ua)) deviceKind = 'Bot';
  else if (/iPad|Tablet/i.test(ua) || (os === 'Android' && !/Mobile/.test(ua))) deviceKind = 'Tablet';
  else if (/Mobi|iPhone/i.test(ua)) deviceKind = 'Mobile';
  else deviceKind = os === 'Unknown' ? 'Unknown' : 'Desktop';

  const model = os === 'Android' ? m(/Android [\d.]+; ([^;)]+?)(?: Build|\))/) : /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : null;
  const engine = /Gecko\/\d/.test(ua) && /Firefox/.test(ua) ? 'Gecko' : /AppleWebKit/.test(ua) ? (/Chrome|Edg|OPR|Headless/.test(ua) && !ios ? 'Blink' : 'WebKit') : null;
  return { browser, browserVersion, os, osVersion, deviceKind, model: model && model !== 'K' ? model : null, engine };
}
