export type BrowserFamily = 'chrome' | 'edge' | 'opera' | 'samsung' | 'firefox' | 'safari' | 'other';
export type OsFamily = 'windows' | 'macos' | 'ios' | 'android' | 'linux' | 'chromeos' | 'other';

export function browserFamily(ua: string): BrowserFamily {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (/OPR\/|Opera/.test(ua)) return 'opera';
  if (/SamsungBrowser\//.test(ua)) return 'samsung';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'safari';
  return 'other';
}

export function osFamily(ua: string): OsFamily {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Windows NT/.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
  if (/Linux|X11/.test(ua)) return 'linux';
  return 'other';
}

export function platformFamily(platform: string): OsFamily {
  const p = platform.toLowerCase();
  if (p.startsWith('win')) return 'windows';
  if (p.startsWith('mac')) return 'macos';
  if (p.startsWith('iphone') || p.startsWith('ipad') || p.startsWith('ipod')) return 'ios';
  if (p.includes('android')) return 'android';
  if (p.includes('cros')) return 'chromeos';
  if (p.includes('linux')) return 'linux';
  return 'other';
}

/** iPadOS reports a Mac platform; Android often reports "Linux armv8l". */
export function platformsCompatible(uaOs: OsFamily, platformOs: OsFamily): boolean {
  if (uaOs === 'other' || platformOs === 'other' || uaOs === platformOs) return true;
  if (uaOs === 'ios' && platformOs === 'macos') return true;
  if (uaOs === 'android' && platformOs === 'linux') return true;
  if (uaOs === 'chromeos' && platformOs === 'linux') return true;
  return false;
}
