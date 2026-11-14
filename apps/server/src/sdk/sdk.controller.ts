import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Controller, Get, Param, Res } from '@nestjs/common';
import { type FastifyReply } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { Auth } from '../common/auth.js';

const FILES = new Set(['sdk.esm.js', 'sdk.global.js', 'sdk.esm.js.map', 'sdk.global.js.map']);

function loadBundles(): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  try {
    const dir = dirname(createRequire(import.meta.url).resolve('@tbdname/sdk-js/browser'));
    for (const name of FILES) out.set(name, readFileSync(join(dir, name)));
  } catch {
    // Not built: the route answers 404 instead of failing startup.
  }
  return out;
}

/**
 * Serves the browser SDK from this server, so sites can load it first-party without a
 * bundler or a third-party CDN. Public, static code: a fixed allow-list of file names
 * (no path input reaches the filesystem), cacheable, and CORS-open so module imports work.
 */
@Controller('sdk')
export class SdkController {
  private readonly bundles = loadBundles();

  @Get(':file')
  @Auth('none')
  serve(@Param('file') file: string, @Res() reply: FastifyReply): void {
    const body = FILES.has(file) ? this.bundles.get(file) : undefined;
    if (!body) throw ApiError.notFound('Not found');
    void reply
      .header('Content-Type', file.endsWith('.map') ? 'application/json' : 'text/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .header('Access-Control-Allow-Origin', '*')
      .send(body);
  }
}
