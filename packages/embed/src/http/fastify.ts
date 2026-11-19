import { type Trace } from '../trace.js';
import { normalizePrefix, route } from './route.js';

/** The parts of a Fastify instance this uses, so any Fastify 4 or 5 works without a type dependency. */
export interface FastifyLike {
  route(opts: {
    method: string | string[];
    url: string;
    handler: (req: FastifyRequestLike, reply: FastifyReplyLike) => Promise<unknown>;
  }): unknown;
  addContentTypeParser?: (type: string, opts: { parseAs: 'string' }, fn: (req: unknown, body: string, done: (err: Error | null, body?: unknown) => void) => void) => unknown;
  hasContentTypeParser?: (type: string) => boolean;
}
interface FastifyRequestLike {
  method: string;
  url: string;
  ip: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}
interface FastifyReplyLike {
  code(status: number): FastifyReplyLike;
  headers(h: Record<string, string>): FastifyReplyLike;
  send(body?: unknown): unknown;
}

export interface FastifyOptions {
  /** Default "/trace". */
  prefix?: string;
}

/**
 * Registers the SDK routes on a Fastify app. In NestJS with the Fastify adapter:
 *
 *   const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
 *   registerFastify(app.getHttpAdapter().getInstance(), trace);
 *
 * Sets client IP from req.ip, so configure Fastify's trustProxy behind a load balancer.
 */
export function registerFastify(app: FastifyLike, trace: Trace, opts: FastifyOptions = {}): void {
  const prefix = normalizePrefix(opts.prefix ?? '/trace');
  // The SDK posts text/plain (a CORS simple request). Fastify has no text/plain parser by default.
  if (app.addContentTypeParser && !app.hasContentTypeParser?.('text/plain')) {
    app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  }
  const handler = async (req: FastifyRequestLike, reply: FastifyReplyLike) => {
    const url = new URL(req.url, 'http://local');
    const out = await route(trace, {
      method: req.method,
      path: url.pathname.slice(prefix.length) || '/',
      query: url.searchParams,
      body: req.body,
      ip: req.ip,
      headers: req.headers,
      identifyPath: `${prefix}/v1/identify`,
    });
    if (!out) return reply.code(404).send();
    return reply.code(out.status).headers(out.headers).send(out.body === null ? undefined : out.body);
  };
  for (const path of ['/v1/identify', '/v1/identify/forget']) {
    app.route({ method: ['POST', 'OPTIONS'], url: `${prefix}${path}`, handler });
  }
}
