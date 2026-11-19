import { describe, expect, it } from 'vitest';
import { automationTool, classifyBot, CRAWLER_RANGE_SOURCES, KNOWN_AGENTS, matchKnownAgent, parseRangeList } from './agents.js';
import { evaluateSignals } from './definitions.js';
import { TEST_SCORING_CONFIG, makeContext } from './testing.js';

const base = { automationDetected: false, automationGlobals: [], webdriver: false, headlessUserAgent: false };

describe('classifyBot', () => {
  it('reports nothing for an ordinary browser', () => {
    expect(classifyBot({ ...base, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36' })).toEqual({
      result: 'notDetected', type: null, name: null, provider: null, identity: null,
    });
  });

  it('names declared search engines and AI crawlers as good, but unsigned', () => {
    expect(classifyBot({ ...base, userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })).toMatchObject({
      result: 'good', type: 'searchEngine', name: 'Googlebot', provider: 'Google', identity: 'unsigned',
    });
    expect(classifyBot({ ...base, userAgent: 'Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.1' })).toMatchObject({ type: 'aiCrawler', provider: 'OpenAI' });
  });

  it('treats an unsigned assistant as bad and a verified signature as good', () => {
    const ua = 'Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0; +https://openai.com/bot';
    expect(classifyBot({ ...base, userAgent: ua })).toMatchObject({ result: 'bad', type: 'aiAgent', name: 'ChatGPT', identity: 'unsigned' });
    expect(classifyBot({ ...base, userAgent: ua, signedAgent: { agent: 'https://chatgpt.com', keyId: 'k', verified: true } })).toMatchObject({
      result: 'good', type: 'aiAgent', name: 'ChatGPT agent', provider: 'OpenAI', identity: 'signed',
    });
  });

  it('ignores a signature that failed verification', () => {
    const r = classifyBot({ ...base, userAgent: 'Chrome/131', signedAgent: { agent: 'https://chatgpt.com', keyId: 'k', verified: false, reason: 'bad_signature' } });
    expect(r.result).toBe('notDetected');
  });

  it('names the automation tool behind a bot', () => {
    expect(classifyBot({ ...base, userAgent: 'Chrome/131', automationDetected: true, automationGlobals: ['__playwright__binding__'] })).toMatchObject({
      result: 'bad', type: 'automation', name: 'Playwright',
    });
    expect(automationTool(['cdc_adoQpoasnfa76pfcZLmcfl_Array'], false, false)).toBe('Selenium');
    expect(automationTool([], false, true)).toBe('Headless Chrome');
    expect(automationTool([], true, false)).toBe('WebDriver');
    expect(automationTool([], false, false)).toBeNull();
  });

  it('matches known agents case-insensitively and returns null for none', () => {
    expect(matchKnownAgent('mozilla/5.0 claude-user/1.0')?.provider).toBe('Anthropic');
    expect(matchKnownAgent(null)).toBeNull();
  });
});

describe('aiAgent signal', () => {
  it('fires for an unsigned assistant and carries its name', () => {
    const ctx = makeContext({ headers: { userAgent: 'Mozilla/5.0; Perplexity-User/1.0', secChUa: null, secChUaPlatform: null } });
    const r = evaluateSignals(ctx, TEST_SCORING_CONFIG).aiAgent;
    expect(r.detected).toBe(true);
    expect(r.details).toMatchObject({ name: 'Perplexity', identity: 'unsigned', signatureAgent: null });
  });

  it('does not fire for a signed agent, or for a crawler', () => {
    const signed = makeContext({ signedAgent: { agent: 'https://chatgpt.com', keyId: 'k', verified: true } });
    expect(evaluateSignals(signed, TEST_SCORING_CONFIG).aiAgent).toMatchObject({ detected: false, details: { identity: 'signed', signatureVerified: true } });
    const crawler = makeContext({ headers: { userAgent: 'GPTBot/1.1', secChUa: null, secChUaPlatform: null } });
    expect(evaluateSignals(crawler, TEST_SCORING_CONFIG).aiAgent.detected).toBe(false);
  });

  it('reports why a signature was rejected', () => {
    const ctx = makeContext({ signedAgent: { agent: 'https://agent.example', keyId: 'k', verified: false, reason: 'agent_not_allowed' } });
    expect(evaluateSignals(ctx, TEST_SCORING_CONFIG).aiAgent.details).toMatchObject({ signatureVerified: false, signatureError: 'agent_not_allowed' });
  });
});

describe('published IP ranges', () => {
  const base = { automationDetected: false, automationGlobals: [], webdriver: false, headlessUserAgent: false, signedAgent: null };
  const gptbot = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
  const chatgpt = 'Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0; +https://openai.com/bot';

  it('verifies AI crawlers and agents from their ranges, and flags impostors', () => {
    expect(classifyBot({ ...base, userAgent: gptbot, crawlerVerified: true })).toMatchObject({ result: 'good', type: 'aiCrawler', identity: 'verified' });
    expect(classifyBot({ ...base, userAgent: gptbot, crawlerVerified: false })).toMatchObject({ result: 'bad', type: 'aiCrawler', name: 'GPTBot' });
    expect(classifyBot({ ...base, userAgent: gptbot, crawlerVerified: null })).toMatchObject({ result: 'good', identity: 'unsigned' });
    expect(classifyBot({ ...base, userAgent: chatgpt, crawlerVerified: true })).toMatchObject({ result: 'good', type: 'aiAgent', identity: 'verified' });
    expect(classifyBot({ ...base, userAgent: chatgpt, crawlerVerified: null })).toMatchObject({ result: 'bad', identity: 'unsigned' });
  });

  it('does not fire aiAgent for an agent verified by its ranges, and does for one outside them', () => {
    const run = (crawlerVerified: boolean | null) =>
      evaluateSignals(makeContext({ headers: { ...makeContext().headers, userAgent: chatgpt }, crawlerVerified }), TEST_SCORING_CONFIG).aiAgent;
    expect(run(true)).toMatchObject({ detected: false, details: { identity: 'verified' } });
    expect(run(false).detected).toBe(true);
    expect(run(null).detected).toBe(true);
  });

  it('parses the published list format, ipv4 and ipv6, and ignores anything else', () => {
    expect(parseRangeList({ creationTime: 'x', prefixes: [{ ipv4Prefix: '132.196.86.0/24' }, { ipv6Prefix: '2001:4860:4801:10::/64' }, { ipv4Prefix: 'nope' }, {}] })).toEqual([
      '132.196.86.0/24',
      '2001:4860:4801:10::/64',
    ]);
    expect(parseRangeList({ items: [] })).toEqual([]);
    expect(parseRangeList(null)).toEqual([]);
    for (const name of Object.keys(CRAWLER_RANGE_SOURCES)) {
      expect(KNOWN_AGENTS.some((a) => a.name === name), name).toBe(true);
    }
  });
});
