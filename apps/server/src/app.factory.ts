import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type FastifyInstance } from 'fastify';
import { type AppDependencies, AppModule } from './app.module.js';
import { AUTH, type Auth, toHeaders } from './auth/auth.js';
import { parseTrustProxy } from './config/env.js';

export const BODY_LIMIT_BYTES = 64 * 1024;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function configureFastify(instance: FastifyInstance): void {
  // The SDK posts JSON as text/plain so browsers skip the CORS preflight.
  instance.removeContentTypeParser('text/plain');
  instance.addContentTypeParser(
    'text/plain',
    { parseAs: 'string', bodyLimit: BODY_LIMIT_BYTES },
    instance.getDefaultJsonParser('error', 'error'),
  );

  instance.addHook('onSend', (req, reply, payload, done) => {
    // Defaults only: a route that sets its own value (e.g. a cacheable SDK file) keeps it.
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!reply.hasHeader(name)) void reply.header(name, value);
    }
    if (req.url.startsWith('/v1/identify')) void reply.header('Vary', 'Origin');
    if (req.corsOrigin) void reply.header('Access-Control-Allow-Origin', req.corsOrigin);
    done(null, payload);
  });
}

/**
 * Better Auth speaks Fetch Request/Response; bridge it onto Fastify outside Nest's router.
 * The dashboard proxies /api/auth/* here, so cookies are first-party on its origin.
 */
function mountAuth(instance: FastifyInstance, auth: Auth, baseUrl: string): void {
  instance.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (req, reply) => {
      const body = req.method === 'POST' && req.body !== undefined ? JSON.stringify(req.body) : undefined;
      const headers = toHeaders(req.headers);
      headers.delete('content-length');
      const response = await auth.handler(
        new Request(new URL(req.url, baseUrl), { method: req.method, headers, ...(body ? { body } : {}) }),
      );
      void reply.status(response.status);
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== 'set-cookie') void reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) void reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

export async function createApp(deps: AppDependencies): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: parseTrustProxy(deps.env.TRUST_PROXY),
    requestTimeout: deps.env.REQUEST_TIMEOUT_MS,
    connectionTimeout: deps.env.REQUEST_TIMEOUT_MS,
    logger: false,
    return503OnClosing: true,
  });
  configureFastify(adapter.getInstance());
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(deps), adapter, {
    logger: deps.env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  mountAuth(adapter.getInstance(), app.get<Auth>(AUTH), deps.env.DASHBOARD_URL);
  await app.init();
  new Logger('Bootstrap').log(`scoring v${deps.scoring.version}, ip storage ${deps.env.IP_STORAGE}`);
  return app;
}
