import { describe, expect, it } from 'vitest';
import { createCrawlerVerifier, type CrawlerResolver, fetchCrawlerRanges } from './crawlers.js';

function resolver(reverse: Record<string, string[]>, forward: Record<string, string[]>, calls: string[] = []): CrawlerResolver {
  return {
    reverse: async (ip) => {
      calls.push(`reverse ${ip}`);
      if (!(ip in reverse)) throw new Error('ENOTFOUND');
      return reverse[ip]!;
    },
    lookup: async (host) => {
      calls.push(`lookup ${host}`);
      return forward[host] ?? [];
    },
  };
}

describe('createCrawlerVerifier', () => {
  const real = resolver({ '66.249.66.1': ['crawl-66-249-66-1.googlebot.com.'] }, { 'crawl-66-249-66-1.googlebot.com': ['66.249.66.1'] });

  it('confirms a crawler whose reverse and forward DNS agree', async () => {
    expect(await createCrawlerVerifier({ resolver: real })('66.249.66.1', 'Googlebot')).toBe(true);
  });

  it('rejects a host outside the operator domain, and one that does not resolve back', async () => {
    const fake = resolver({ '203.0.113.9': ['googlebot.com.evil.example'] }, { 'googlebot.com.evil.example': ['203.0.113.9'] });
    expect(await createCrawlerVerifier({ resolver: fake })('203.0.113.9', 'Googlebot')).toBe(false);
    const noForward = resolver({ '203.0.113.10': ['crawl.googlebot.com'] }, { 'crawl.googlebot.com': ['66.249.66.2'] });
    expect(await createCrawlerVerifier({ resolver: noForward })('203.0.113.10', 'Googlebot')).toBe(false);
    expect(await createCrawlerVerifier({ resolver: real })('198.51.100.1', 'Googlebot')).toBe(false);
  });

  it('returns null for crawlers it cannot check, and on timeout', async () => {
    expect(await createCrawlerVerifier({ resolver: real })('66.249.66.1', 'DuckDuckBot')).toBeNull();
    const slow: CrawlerResolver = { reverse: () => new Promise(() => {}), lookup: async () => [] };
    expect(await createCrawlerVerifier({ resolver: slow, timeoutMs: 20 })('66.249.66.1', 'Googlebot')).toBeNull();
  });

  it('caches results per IP', async () => {
    const calls: string[] = [];
    const verify = createCrawlerVerifier({ resolver: resolver({ '66.249.66.1': ['a.googlebot.com'] }, { 'a.googlebot.com': ['66.249.66.1'] }, calls) });
    await verify('66.249.66.1', 'Googlebot');
    await verify('66.249.66.1', 'Googlebot');
    expect(calls.filter((c) => c.startsWith('reverse'))).toHaveLength(1);
  });
});

describe('published IP ranges', () => {
  const never: CrawlerResolver = {
    reverse: () => Promise.reject(new Error('DNS must not be used')),
    lookup: () => Promise.reject(new Error('DNS must not be used')),
  };

  it('checks a crawler with a list against it, ipv4 and ipv6, without DNS', async () => {
    const verify = createCrawlerVerifier({ resolver: never, ranges: { GPTBot: ['132.196.86.0/24', 'bad', '2001:db8::/32'] } });
    expect(await verify('132.196.86.7', 'GPTBot')).toBe(true);
    expect(await verify('203.0.113.9', 'GPTBot')).toBe(false);
    expect(await verify('2001:db8:1::5', 'GPTBot')).toBe(true);
    expect(await verify('not-an-ip', 'GPTBot')).toBe(false);
    // No list and no DNS rule: unchecked.
    expect(await verify('132.196.86.7', 'ClaudeBot')).toBeNull();
  });

  it('falls back to reverse DNS for a search engine without a list', async () => {
    const resolver: CrawlerResolver = {
      reverse: async () => ['crawl-66-249-66-1.googlebot.com'],
      lookup: async () => ['66.249.66.1'],
    };
    expect(await createCrawlerVerifier({ resolver, ranges: { GPTBot: ['132.196.86.0/24'] } })('66.249.66.1', 'Googlebot')).toBe(true);
  });

  it('downloads the published lists and reports the ones that failed', async () => {
    const fakeFetch = (async (url: string) => {
      if (url.includes('good')) return new Response(JSON.stringify({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }), { status: 200 });
      if (url.includes('empty')) return new Response('{"prefixes":[]}', { status: 200 });
      return new Response('gone', { status: 404 });
    }) as unknown as typeof fetch;
    const r = await fetchCrawlerRanges({ fetch: fakeFetch, sources: { A: 'https://x/good', B: 'https://x/empty', C: 'https://x/missing' } });
    expect(r.ranges).toEqual({ A: ['192.0.2.0/24'] });
    expect(r.failed.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'B', reason: 'no prefixes' },
      { name: 'C', reason: 'HTTP 404' },
    ]);
  });
});
