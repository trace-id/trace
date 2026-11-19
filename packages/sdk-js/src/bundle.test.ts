import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A path, not a URL: under happy-dom the global URL is not Node's, and fs rejects it.
const BUNDLE = join(import.meta.dirname, '../dist/browser/sdk.global.js');

describe.skipIf(!existsSync(BUNDLE))('single-file browser bundle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { Trace?: unknown }).Trace;
  });

  it('exposes window.Trace and completes an identify call', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ eventId: 'e', visitorId: 'v', confidence: 1, suspectScore: 0, token: 't.x' }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    type Sdk = { createClient: (o: object) => { get: () => Promise<unknown> } };
    // The IIFE declares `var Trace`; evaluate it as a classic script would and read it back.
    const sdk = new Function(`${readFileSync(BUNDLE, 'utf8')}\nreturn Trace;`)() as Sdk | undefined;
    expect(typeof sdk?.createClient).toBe('function');
    const result = await sdk?.createClient({ apiKey: 'pk_x', endpoint: 'https://id.example.test', persistToken: false }).get();
    expect(result).toEqual({ eventId: 'e', visitorId: 'v', confidence: 1, suspectScore: 0 });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as {
      signals: { components: Record<string, string> };
    };
    expect(Object.keys(body.signals.components).length).toBeGreaterThan(5);
  });
});
