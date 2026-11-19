/**
 * Bot and AI-agent classification. Pure: it reads the request headers, the browser's automation indicators and, when the
 * server verified one, a signed agent identity (Web Bot Auth, see web-bot-auth.ts). No I/O.
 *
 * A user-agent match alone proves nothing: anyone can send "Googlebot". Such matches are reported with identity "unsigned"
 * so the caller can decide; only a verified HTTP message signature yields identity "signed".
 */

export type BotResult = 'good' | 'bad' | 'notDetected';
export type BotType = 'searchEngine' | 'aiAgent' | 'aiCrawler' | 'automation';

export interface BotInfo {
  /** good: a declared or verified well-behaved bot; bad: automation or an unsigned agent; notDetected: no bot seen. */
  result: BotResult;
  type: BotType | null;
  /** e.g. "Googlebot", "ChatGPT agent", "Playwright"; null when only generic automation was seen. */
  name: string | null;
  provider: string | null;
  /**
   * signed: proven by a verified HTTP message signature. verified: a crawler confirmed by forward-confirmed reverse DNS.
   * unsigned: only claimed (user agent) or inferred.
   */
  identity: 'signed' | 'verified' | 'unsigned' | null;
}

/** A Web Bot Auth signature the server checked against the agent's published key directory. */
export interface SignedAgent {
  /** Origin of the Signature-Agent key directory, e.g. "https://chatgpt.com". */
  agent: string;
  keyId: string;
  verified: boolean;
  /** Why verification failed, when it did. */
  reason?: string;
}

interface KnownAgent {
  pattern: RegExp;
  name: string;
  provider: string;
  type: BotType;
}

/** User-agent tokens published by their operators. Order matters: the first match wins. */
export const KNOWN_AGENTS: readonly KnownAgent[] = [
  // Assistants acting for a person (user-initiated fetches and browsing).
  { pattern: /ChatGPT-User/i, name: 'ChatGPT', provider: 'OpenAI', type: 'aiAgent' },
  { pattern: /Claude-User/i, name: 'Claude', provider: 'Anthropic', type: 'aiAgent' },
  { pattern: /Perplexity-User/i, name: 'Perplexity', provider: 'Perplexity', type: 'aiAgent' },
  { pattern: /MistralAI-User/i, name: 'Le Chat', provider: 'Mistral AI', type: 'aiAgent' },
  { pattern: /DuckAssistBot/i, name: 'DuckAssist', provider: 'DuckDuckGo', type: 'aiAgent' },
  // AI crawlers (training and search indexes).
  { pattern: /GPTBot/i, name: 'GPTBot', provider: 'OpenAI', type: 'aiCrawler' },
  { pattern: /OAI-SearchBot/i, name: 'OAI-SearchBot', provider: 'OpenAI', type: 'aiCrawler' },
  { pattern: /Claude-SearchBot/i, name: 'Claude-SearchBot', provider: 'Anthropic', type: 'aiCrawler' },
  { pattern: /ClaudeBot/i, name: 'ClaudeBot', provider: 'Anthropic', type: 'aiCrawler' },
  { pattern: /PerplexityBot/i, name: 'PerplexityBot', provider: 'Perplexity', type: 'aiCrawler' },
  { pattern: /Meta-ExternalAgent/i, name: 'Meta-ExternalAgent', provider: 'Meta', type: 'aiCrawler' },
  { pattern: /Bytespider/i, name: 'Bytespider', provider: 'ByteDance', type: 'aiCrawler' },
  { pattern: /Amazonbot/i, name: 'Amazonbot', provider: 'Amazon', type: 'aiCrawler' },
  { pattern: /CCBot/i, name: 'CCBot', provider: 'Common Crawl', type: 'aiCrawler' },
  // Search engines.
  { pattern: /Googlebot|Google-InspectionTool/i, name: 'Googlebot', provider: 'Google', type: 'searchEngine' },
  { pattern: /bingbot/i, name: 'Bingbot', provider: 'Microsoft', type: 'searchEngine' },
  { pattern: /Applebot/i, name: 'Applebot', provider: 'Apple', type: 'searchEngine' },
  { pattern: /DuckDuckBot/i, name: 'DuckDuckBot', provider: 'DuckDuckGo', type: 'searchEngine' },
  { pattern: /YandexBot/i, name: 'YandexBot', provider: 'Yandex', type: 'searchEngine' },
  { pattern: /Baiduspider/i, name: 'Baiduspider', provider: 'Baidu', type: 'searchEngine' },
  { pattern: /Yahoo! Slurp/i, name: 'Yahoo Slurp', provider: 'Yahoo', type: 'searchEngine' },
];

/** Key directories of agents that sign their requests, by origin. Unknown origins are reported by host name. */
export const SIGNED_AGENT_NAMES: Record<string, { name: string; provider: string }> = {
  'https://chatgpt.com': { name: 'ChatGPT agent', provider: 'OpenAI' },
};

/** Automation markers from the browser SDK (BotIndicators.automationGlobals), by tool. */
const AUTOMATION_TOOLS: [RegExp, string][] = [
  [/__playwright|__pwInitScripts/, 'Playwright'],
  [/__puppeteer/, 'Puppeteer'],
  [/cdc_|__webdriver|__driver|__selenium|_Selenium_IDE|__fxdriver/, 'Selenium'],
  [/_phantom|callPhantom/, 'PhantomJS'],
  [/__nightmare/, 'Nightmare'],
  [/domAutomation/, 'Chrome automation'],
];

export function matchKnownAgent(userAgent: string | null | undefined): KnownAgent | null {
  if (!userAgent) return null;
  return KNOWN_AGENTS.find((a) => a.pattern.test(userAgent)) ?? null;
}

export function automationTool(globals: readonly string[], webdriver: boolean, headlessUserAgent: boolean): string | null {
  for (const [re, name] of AUTOMATION_TOOLS) if (globals.some((g) => re.test(g))) return name;
  if (headlessUserAgent) return 'Headless Chrome';
  if (webdriver) return 'WebDriver';
  return null;
}

export interface ClassifyInput {
  /** The HTTP User-Agent header, falling back to the one the browser reported. */
  userAgent: string | null;
  /** The bot signal fired (automation indicators). */
  automationDetected: boolean;
  automationGlobals: readonly string[];
  webdriver: boolean;
  headlessUserAgent: boolean;
  signedAgent?: SignedAgent | null;
  /** Reverse-DNS check of a claimed search-engine crawler: true confirmed, false failed, null not checked. */
  crawlerVerified?: boolean | null;
}

/** Search engines whose crawlers can be confirmed by reverse DNS, with the host suffixes their operators publish. */
export const CRAWLER_DNS: Record<string, readonly string[]> = {
  Googlebot: ['.googlebot.com', '.google.com', '.googleusercontent.com'],
  Bingbot: ['.search.msn.com'],
  Applebot: ['.applebot.apple.com'],
  YandexBot: ['.yandex.ru', '.yandex.net', '.yandex.com'],
  Baiduspider: ['.baidu.com', '.baidu.jp'],
  'Yahoo Slurp': ['.crawl.yahoo.net'],
};

/**
 * IP range lists that crawler and agent operators publish, keyed by the name matchKnownAgent returns. All use the same
 * JSON shape: { "prefixes": [{ "ipv4Prefix": "..." } | { "ipv6Prefix": "..." }] }. Fetch them on a schedule (they
 * change) and pass the result to the crawler verifier; Trace never fetches them while handling a request.
 */
export const CRAWLER_RANGE_SOURCES: Readonly<Record<string, string>> = {
  GPTBot: 'https://openai.com/gptbot.json',
  'OAI-SearchBot': 'https://openai.com/searchbot.json',
  ChatGPT: 'https://openai.com/chatgpt-user.json',
  PerplexityBot: 'https://www.perplexity.ai/perplexitybot.json',
  Perplexity: 'https://www.perplexity.ai/perplexity-user.json',
  Googlebot: 'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
  Bingbot: 'https://www.bing.com/toolbox/bingbot.json',
};

/** CIDR prefixes from a published range list; [] when the document has another shape. */
export function parseRangeList(doc: unknown): string[] {
  const prefixes = (doc as { prefixes?: unknown } | null)?.prefixes;
  if (!Array.isArray(prefixes)) return [];
  const out: string[] = [];
  for (const p of prefixes) {
    const v = (p as { ipv4Prefix?: unknown; ipv6Prefix?: unknown } | null)?.ipv4Prefix ?? (p as { ipv6Prefix?: unknown } | null)?.ipv6Prefix;
    if (typeof v === 'string' && /^[0-9a-fA-F:.]+\/\d{1,3}$/.test(v)) out.push(v);
  }
  return out;
}

export function classifyBot(input: ClassifyInput): BotInfo {
  const signed = input.signedAgent;
  if (signed?.verified) {
    const known = SIGNED_AGENT_NAMES[signed.agent];
    const host = signed.agent.replace(/^https:\/\//, '');
    return { result: 'good', type: 'aiAgent', name: known?.name ?? host, provider: known?.provider ?? host, identity: 'signed' };
  }
  const known = matchKnownAgent(input.userAgent);
  if (known) {
    // Verified by reverse DNS or by the operator's published IP ranges. A request using the name from anywhere else
    // is an impostor.
    if (input.crawlerVerified === true) {
      return { result: 'good', type: known.type, name: known.name, provider: known.provider, identity: 'verified' };
    }
    if (input.crawlerVerified === false) {
      return { result: 'bad', type: known.type, name: known.name, provider: known.provider, identity: 'unsigned' };
    }
    // Declared crawlers announce themselves and follow robots.txt; assistants acting for a person are unverified here.
    const result: BotResult = known.type === 'aiAgent' ? 'bad' : 'good';
    return { result, type: known.type, name: known.name, provider: known.provider, identity: 'unsigned' };
  }
  if (input.automationDetected) {
    return { result: 'bad', type: 'automation', name: automationTool(input.automationGlobals, input.webdriver, input.headlessUserAgent), provider: null, identity: null };
  }
  return { result: 'notDetected', type: null, name: null, provider: null, identity: null };
}
