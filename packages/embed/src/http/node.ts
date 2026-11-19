import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Trace } from '../trace.js';
import { normalizePrefix, route } from './route.js';

export interface NodeHandlerOptions {
  /** Where the routes are mounted. Default "/trace". */
  prefix?: string;
  /** The client IP. Default: req.ip (Express with "trust proxy"), then the socket address. */
  getIp?: (req: IncomingMessage) => string;
}

type Next = (err?: unknown) => void;

function readBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  // A body parser may have run already (Express json/text middleware).
  if (req.body !== undefined) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Over the cap: stop keeping data but drain the rest, so the client still gets a clean 413.
      if (size > 64 * 1024) tooBig = true;
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(Object.assign(new Error('Body over 64 KB'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

/**
 * Middleware for Express, Connect, Polka, or plain node:http. Calls next() for paths it does not own.
 *
 *   app.use(toNodeHandler(trace));            // Express: serves /trace/v1/identify
 */
export function toNodeHandler(trace: Trace, opts: NodeHandlerOptions = {}) {
  const prefix = normalizePrefix(opts.prefix ?? '/trace');
  const getIp = opts.getIp ?? ((req: IncomingMessage) => (req as IncomingMessage & { ip?: string }).ip ?? req.socket.remoteAddress ?? '0.0.0.0');
  return async (req: IncomingMessage, res: ServerResponse, next?: Next): Promise<void> => {
    const url = new URL((req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/', 'http://local');
    const owned = !prefix || url.pathname.startsWith(prefix);
    try {
      const out = owned
        ? await route(trace, {
            method: req.method ?? 'GET',
            path: url.pathname.slice(prefix.length) || '/',
            query: url.searchParams,
            body: req.method === 'POST' ? await readBody(req) : null,
            ip: getIp(req),
            headers: req.headers,
            identifyPath: `${prefix}/v1/identify`,
          })
        : null;
      if (!out) {
        if (next) next();
        else res.writeHead(404).end();
        return;
      }
      res.writeHead(out.status, out.headers);
      res.end(out.body === null ? undefined : JSON.stringify(out.body));
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 413) {
        res.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: 'payload_too_large', message: 'Body over 64 KB' } }));
        return;
      }
      if (next) next(err);
      else res.writeHead(500).end();
    }
  };
}
