import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TraceApi } from './api.js';
import { createMcpServer } from './server.js';

const EVENT_ID = '01a1dcf6-53b8-7c68-bd1d-65941803eae7';
const EVENT = {
  eventId: EVENT_ID,
  visitorId: 'LKf5TfnSd3QB5FPbT13g',
  deviceId: 'LKf5TfnSd3QB5FPbT13g',
  confidence: 0.99,
  matchKind: 'token',
  suspectScore: 75,
  reasons: [{ signal: 'bot', contribution: 60 }, { signal: 'virtualMachine', contribution: 15 }],
  signals: {
    bot: { detected: true, details: { headlessUserAgent: true, weakIndicatorCount: 0 } },
    virtualMachine: { detected: true, details: { renderer: 'SwiftShader', matched: 'swiftshader' } },
    vpn: { detected: false, details: { available: false, timezoneCheck: 'noCountry' } },
    tor: { detected: false, details: {} },
  },
  components: {},
  attributes: { screenWidth: 800, screenHeight: 600, timezone: 'UTC', languages: ['en'], platform: 'Linux', userAgent: 'HeadlessChrome' },
  ip: { address: '1.2.3.0', country: null, asn: null },
  tags: null,
  linkedId: 'user-7',
  linkedVisitors: [{ visitorId: 'Qp8aaaaaaaaaaaaaaaaa', confidence: 0.92, browser: 'firefox', sameNetwork: true, sharedNetworks: 1, via: 'sharedNetwork', lastSeenAt: '2026-11-15T11:00:00.000Z' }],
  createdAt: '2026-11-15T12:00:00.000Z',
  expiresAt: '2026-11-15T13:00:00.000Z',
};

let http: Server;
let endpoint = '';
const deleted: string[] = [];

beforeAll(async () => {
  http = createServer((req, res) => {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Bearer sk_test') return send(401, { error: { code: 'invalid_api_key', message: 'bad key' } });
    const url = req.url ?? '';
    if (url === `/v1/events/${EVENT_ID}`) return send(200, EVENT);
    if (url.startsWith('/v1/visitors/') && req.method === 'DELETE') {
      deleted.push(url.split('/')[3]!);
      return send(204);
    }
    if (url.startsWith('/v1/visitors/LKf5')) return send(200, { visitorId: 'LKf5TfnSd3QB5FPbT13g', deviceId: 'LKf5TfnSd3QB5FPbT13g', events: [], url });
    if (url.startsWith('/v1/devices/')) return send(200, { deviceId: 'LKf5TfnSd3QB5FPbT13g', visitors: [], accounts: [{ linkedId: 'user-7' }] });
    return send(404, { error: { code: 'not_found', message: 'Not found' } });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => http.close(() => r())));

const server = (allowDelete = false, key = 'sk_test') => createMcpServer({ api: new TraceApi({ endpoint, secretKey: key }), allowDelete });
const call = (s: ReturnType<typeof server>, name: string, args: Record<string, unknown> = {}) =>
  s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

describe('MCP protocol', () => {
  it('negotiates the protocol version and describes itself', async () => {
    const r = (await server().handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })) as { result: Record<string, unknown> };
    expect(r.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'trace' } });
    const future = (await server().handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2099-01-01' } })) as { result: { protocolVersion: string } };
    expect(future.result.protocolVersion).toBe('2025-06-18');
  });

  it('answers ping, ignores notifications and rejects unknown methods and bad messages', async () => {
    const s = server();
    expect(await s.handle({ jsonrpc: '2.0', id: 2, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
    expect(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await s.handle({ jsonrpc: '2.0', id: 3, method: 'nope' })).toMatchObject({ error: { code: -32601 } });
    expect(await s.handle({ hello: 'world' })).toMatchObject({ error: { code: -32600 } });
  });

  it('lists read-only tools, and delete_visitor only when allowed', async () => {
    const list = (async (s: ReturnType<typeof server>) => ((await s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[] } }).result.tools);
    const tools = await list(server());
    expect(tools.map((t) => t.name)).toEqual(['get_event', 'explain_event', 'get_visitor', 'get_device', 'list_signals']);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    const withDelete = await list(server(true));
    expect(withDelete.find((t) => t.name === 'delete_visitor')?.annotations.destructiveHint).toBe(true);
  });
});

describe('MCP tools', () => {
  it('get_event returns text and structured content', async () => {
    const r = (await call(server(), 'get_event', { eventId: EVENT_ID })) as { result: { structuredContent: { suspectScore: number }; content: { text: string }[] } };
    expect(r.result.structuredContent.suspectScore).toBe(75);
    expect(JSON.parse(r.result.content[0]!.text).visitorId).toBe('LKf5TfnSd3QB5FPbT13g');
  });

  it('explain_event gives a verdict, the fired signals with caveats, unavailable signals and linked browsers', async () => {
    const r = (await call(server(), 'explain_event', { eventId: EVENT_ID })) as { result: { content: { text: string }[] } };
    const text = r.result.content[0]!.text;
    expect(text).toContain('suspect score 75/100. High risk');
    expect(text).toContain('- Bot / automation (+60): headlessUserAgent=true');
    expect(text).toContain('Can be wrong when:');
    expect(text).toContain('Not evaluated on this server (missing data or configuration): vpn.');
    expect(text).toContain('Qp8aaaaaaaaaaaaaaaaa (firefox), 92% via sharedNetwork');
    expect(text).not.toContain('Tor exit node');
  });

  it('get_visitor passes paging, get_device and list_signals work', async () => {
    const v = (await call(server(), 'get_visitor', { visitorId: 'LKf5TfnSd3QB5FPbT13g', limit: 5, cursor: 'abc' })) as { result: { structuredContent: { url: string } } };
    expect(v.result.structuredContent.url).toBe('/v1/visitors/LKf5TfnSd3QB5FPbT13g?limit=5&cursor=abc');
    const d = (await call(server(), 'get_device', { deviceId: 'LKf5TfnSd3QB5FPbT13g' })) as { result: { structuredContent: { accounts: unknown[] } } };
    expect(d.result.structuredContent.accounts).toHaveLength(1);
    const s = (await call(server(), 'list_signals')) as { result: { structuredContent: { signals: { id: string }[] } } };
    expect(s.result.structuredContent.signals.map((x) => x.id)).toContain('antiDetect');
  });

  it('reports API failures as tool errors the model can read, and bad arguments as protocol errors', async () => {
    const r = (await call(server(false, 'sk_wrong'), 'get_event', { eventId: EVENT_ID })) as { result: { isError: boolean; content: { text: string }[] } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0]!.text).toBe('Error: invalid_api_key (HTTP 401): bad key');
    expect(await call(server(), 'get_event', {})).toMatchObject({ error: { code: -32602 } });
    expect(await call(server(), 'no_such_tool')).toMatchObject({ error: { code: -32602 } });
  });

  it('delete_visitor needs the opt-in and confirm: true', async () => {
    expect(await call(server(false), 'delete_visitor', { visitorId: 'LKf5TfnSd3QB5FPbT13g', confirm: true })).toMatchObject({ error: { code: -32602 } });
    expect(await call(server(true), 'delete_visitor', { visitorId: 'LKf5TfnSd3QB5FPbT13g' })).toMatchObject({ error: { code: -32602 } });
    const r = (await call(server(true), 'delete_visitor', { visitorId: 'LKf5TfnSd3QB5FPbT13g', confirm: true })) as { result: { content: { text: string }[] } };
    expect(r.result.content[0]!.text).toContain('Deleted visitor LKf5TfnSd3QB5FPbT13g');
    expect(deleted).toEqual(['LKf5TfnSd3QB5FPbT13g']);
  });
});

describe('stdio transport', () => {
  it('speaks newline-delimited JSON-RPC from the built CLI', async () => {
    const cli = join(import.meta.dirname, '..', 'dist', 'cli.js');
    const child = spawn(process.execPath, [cli], { env: { ...process.env, TRACE_ENDPOINT: endpoint, TRACE_SECRET_KEY: 'sk_test' } });
    const lines: string[] = [];
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        lines.push(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'explain_event', arguments: { eventId: EVENT_ID } } });
    child.stdin.write('not json\n');
    const deadline = Date.now() + 5000;
    while (lines.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    child.kill();
    const parsed = lines.map((l) => JSON.parse(l) as { id: number | null; result?: { content?: { text: string }[] }; error?: { code: number } });
    expect(parsed.find((m) => m.id === 1)?.result).toBeDefined();
    expect(parsed.find((m) => m.id === 2)?.result?.content?.[0]?.text).toContain('High risk');
    expect(parsed.find((m) => m.error?.code === -32700)).toBeDefined();
  });
});
