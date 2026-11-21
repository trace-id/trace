import { SIGNAL_DEFINITIONS } from '@trace-id/signals/definitions';
import { ApiError, type TraceApi } from './api.js';
import { explainEvent } from './explain.js';

/**
 * Model Context Protocol server (JSON-RPC 2.0, one message per line over stdio). Implements the parts of the spec a
 * tools-only server needs: initialize, ping, tools/list and tools/call.
 */

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SERVER_INFO = { name: 'trace', title: 'Trace device intelligence', version: '0.1.1' };

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  run(args: Record<string, unknown>): Promise<{ text: string; structured?: unknown }>;
}

const EVENT_ID = { type: 'string', description: 'Event id (UUIDv7) from an identify response, e.g. 01a1dcf6-53b8-7c68-bd1d-65941803eae7' };
const VISITOR_ID = { type: 'string', pattern: '^[0-9A-Za-z]{20}$', description: '20-character visitor id' };
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v === '') throw new InvalidParams(`"${key}" is required and must be a string`);
  return v;
}

class InvalidParams extends Error {}

export interface ServerOptions {
  api: TraceApi;
  /** Exposes delete_visitor. Off unless the operator opts in. */
  allowDelete?: boolean;
}

export function createMcpServer(options: ServerOptions) {
  const { api } = options;
  const tools: ToolDef[] = [
    {
      name: 'get_event',
      title: 'Get event',
      description:
        'Fetch the server-verified record of one identification: visitorId, deviceId, suspect score with reasons, every signal with details, linked browsers, IP country. Use the eventId your app received from the browser SDK.',
      inputSchema: { type: 'object', properties: { eventId: EVENT_ID }, required: ['eventId'], additionalProperties: false },
      annotations: readOnly,
      async run(args) {
        const e = await api.event(str(args, 'eventId'));
        return { text: JSON.stringify(e, null, 2), structured: e };
      },
    },
    {
      name: 'explain_event',
      title: 'Explain event',
      description:
        'Plain-language explanation of one event: the verdict for its suspect score, which signals fired and why, when each can be wrong, other browsers on the same device. Use it to answer "why was this user flagged?".',
      inputSchema: { type: 'object', properties: { eventId: EVENT_ID }, required: ['eventId'], additionalProperties: false },
      annotations: readOnly,
      async run(args) {
        return { text: explainEvent(await api.event(str(args, 'eventId'))) };
      },
    },
    {
      name: 'get_visitor',
      title: 'Get visitor history',
      description: "A visitor's first and last sighting, its deviceId and its events (newest first, paginated).",
      inputSchema: {
        type: 'object',
        properties: {
          visitorId: VISITOR_ID,
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Events per page (default 20)' },
          cursor: { type: 'string', description: 'nextCursor from the previous page' },
        },
        required: ['visitorId'],
        additionalProperties: false,
      },
      annotations: readOnly,
      async run(args) {
        const limit = typeof args.limit === 'number' ? args.limit : undefined;
        const cursor = typeof args.cursor === 'string' ? args.cursor : undefined;
        const v = await api.visitor(str(args, 'visitorId'), limit, cursor);
        return { text: JSON.stringify(v, null, 2), structured: v };
      },
    },
    {
      name: 'get_device',
      title: 'Get device graph',
      description:
        'Every browser (visitor) that shares a deviceId and every account (linkedId) seen on them. Use it to investigate multi-accounting: one device, many accounts.',
      inputSchema: { type: 'object', properties: { deviceId: { ...VISITOR_ID, description: 'deviceId from an event' } }, required: ['deviceId'], additionalProperties: false },
      annotations: readOnly,
      async run(args) {
        const d = await api.device(str(args, 'deviceId'));
        return { text: JSON.stringify(d, null, 2), structured: d };
      },
    },
    {
      name: 'list_signals',
      title: 'List signals',
      description: 'The signal catalog: what each fraud signal detects and when it can be wrong. No network call.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: readOnly,
      async run() {
        const list = SIGNAL_DEFINITIONS.map((d) => ({ id: d.id, title: d.title, description: d.description, falsePositives: d.falsePositives }));
        return { text: list.map((s) => `${s.id} (${s.title}): ${s.description}\n  Can be wrong when: ${s.falsePositives}`).join('\n'), structured: { signals: list } };
      },
    },
  ];
  if (options.allowDelete) {
    tools.push({
      name: 'delete_visitor',
      title: 'Delete visitor (permanent)',
      description:
        'Permanently delete a visitor and all of its events, for a data-deletion request. Cannot be undone. Requires confirm: true.',
      inputSchema: {
        type: 'object',
        properties: { visitorId: VISITOR_ID, confirm: { type: 'boolean', const: true, description: 'Must be true' } },
        required: ['visitorId', 'confirm'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      async run(args) {
        if (args.confirm !== true) throw new InvalidParams('"confirm" must be true');
        const id = str(args, 'visitorId');
        await api.deleteVisitor(id);
        return { text: `Deleted visitor ${id} and all of its events.` };
      },
    });
  }

  const ok = (id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: id ?? null, result });
  const fail = (id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  async function handle(raw: unknown): Promise<JsonRpcResponse | null> {
    if (typeof raw !== 'object' || raw === null || (raw as JsonRpcRequest).jsonrpc !== '2.0' || typeof (raw as JsonRpcRequest).method !== 'string') {
      return fail(null, -32600, 'Invalid request');
    }
    const req = raw as JsonRpcRequest;
    const isNotification = req.id === undefined;
    switch (req.method) {
      case 'initialize': {
        const asked = typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '';
        const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return ok(req.id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Read-only access to Trace device intelligence. Start from an eventId your app logged (explain_event for a verdict, get_event for raw data), follow deviceId with get_device to find other accounts on the same device, and use list_signals to understand a signal. Scores are 0-100; 60+ is high risk.',
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return ok(req.id, {});
      case 'tools/list':
        return ok(req.id, { tools: tools.map(({ run: _run, ...t }) => t) });
      case 'tools/call': {
        const name = req.params?.name;
        const tool = tools.find((t) => t.name === name);
        if (!tool) return fail(req.id, -32602, `Unknown tool: ${String(name)}`);
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const out = await tool.run(args);
          return ok(req.id, { content: [{ type: 'text', text: out.text }], ...(out.structured !== undefined ? { structuredContent: out.structured } : {}) });
        } catch (err) {
          if (err instanceof InvalidParams) return fail(req.id, -32602, err.message);
          // Tool errors go back as results so the model can read them and adjust (MCP convention).
          const message = err instanceof ApiError ? `${err.code} (HTTP ${err.status}): ${err.message}` : err instanceof Error ? err.message : String(err);
          return ok(req.id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
        }
      }
      default:
        return isNotification ? null : fail(req.id, -32601, `Method not found: ${req.method}`);
    }
  }

  return { handle, tools: () => tools.map((t) => t.name) };
}

/** Reads newline-delimited JSON-RPC from input, writes responses to output. Logs go to stderr only. */
export function serveStdio(server: ReturnType<typeof createMcpServer>, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      void server.handle(msg).then((res) => {
        if (res) output.write(`${JSON.stringify(res)}\n`);
      });
    }
  });
}
