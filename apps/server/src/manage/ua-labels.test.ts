import { describe, expect, it } from 'vitest';
import { uaLabels } from './ua-labels.js';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const HEADLESS = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36';

describe('uaLabels', () => {
  it('names the browser, OS and device type', () => {
    expect(uaLabels(CHROME_WIN)).toEqual({ browser: 'Chrome', os: 'Windows', deviceType: 'Desktop' });
    expect(uaLabels(IPHONE)).toEqual({ browser: 'Safari', os: 'iOS', deviceType: 'Mobile' });
    expect(uaLabels(PIXEL)).toEqual({ browser: 'Chrome', os: 'Android', deviceType: 'Mobile' });
  });

  it('tells a tablet from a phone', () => {
    expect(uaLabels(IPAD).deviceType).toBe('Tablet');
  });

  it('calls out headless browsers as bots', () => {
    expect(uaLabels(HEADLESS)).toMatchObject({ browser: 'Headless Chrome', deviceType: 'Bot' });
  });

  it('handles a missing user agent', () => {
    expect(uaLabels(null)).toEqual({ browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown' });
  });
});
