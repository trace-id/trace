import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type FastifyInstance } from 'fastify';
import { type AppDependencies, AppModule } from './app.module.js';
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
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) void reply.header(name, value);
    if (req.url.startsWith('/v1/identify')) void reply.header('Vary', 'Origin');
    if (req.corsOrigin) void reply.header('Access-Control-Allow-Origin', req.corsOrigin);
    done(null, payload);
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
  await app.init();
  new Logger('Bootstrap').log(`scoring v${deps.scoring.version}, ip storage ${deps.env.IP_STORAGE}`);
  return app;
}
