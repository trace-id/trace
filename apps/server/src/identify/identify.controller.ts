import { Controller, HttpCode, Options, Post, Req, Res } from '@nestjs/common';
import { type IdentifyResponse } from '@tbdname/signals/api';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { Auth, requireAuth } from '../common/auth.js';
import { parseIdentifyRequest } from './identify.schema.js';
import { IdentifyService } from './identify.service.js';

function header(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' ? value.slice(0, 512) : null;
}

/**
 * Attack surface: DoS (body capped at 64 KB, per key/IP/visitor rate limits), key abuse
 * (public key only, Origin checked against the key; non-browser clients can forge Origin,
 * which is why rate limits and server-side verification exist), forgery (the response is
 * deliberately small and the full verdict is only readable with a secret key), replay of
 * tokens (HMAC-bound to the project, and must agree with the device's signals).
 */
@Controller('v1/identify')
export class IdentifyController {
  constructor(private readonly identifyService: IdentifyService) {}

  @Post()
  @HttpCode(200)
  @Auth('public')
  async identify(@Req() req: FastifyRequest): Promise<IdentifyResponse> {
    const key = requireAuth(req);
    const parsed = parseIdentifyRequest(req.body);
    if (!parsed.ok) throw ApiError.badRequest(parsed.message);
    return this.identifyService.identify(parsed.value, {
      key,
      ip: req.ip,
      headers: {
        userAgent: header(req, 'user-agent'),
        secChUa: header(req, 'sec-ch-ua'),
        secChUaPlatform: header(req, 'sec-ch-ua-platform'),
      },
    });
  }

  /** Preflight is only needed if a caller sends JSON; the SDK uses a simple request. */
  @Options()
  @Auth('public')
  preflight(@Res() reply: FastifyReply): void {
    void reply
      .header('Access-Control-Allow-Methods', 'POST')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .header('Access-Control-Max-Age', '600')
      .status(204)
      .send();
  }
}
