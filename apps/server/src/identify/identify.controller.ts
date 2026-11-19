import { Controller, HttpCode, Inject, Options, Post, Req, Res } from '@nestjs/common';
import { createAgentVerifier } from '@trace-id/sdk-node/agents';
import { type IdentifyResponse } from '@trace-id/signals/api';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { Auth, requireAuth } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { TlsIntelService } from '../intel/tls-intel.js';
import { parseIdentifyRequest } from './identify.schema.js';
import { IdentifyService } from './identify.service.js';
import { type CookieOptions, clearedVisitorCookie, readVisitorCookie, visitorCookie } from './visitor-cookie.js';

function header(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' ? value.slice(0, 512) : null;
}

/**
 * Attack surface: DoS (body capped at 64 KB, per key/IP/visitor rate limits), key abuse
 * (public key only, Origin checked against the key; non-browser clients can forge Origin,
 * which is why rate limits and server-side verification exist), forgery (the response is
 * deliberately small and the full verdict is only readable with a secret key), replay of
 * tokens (HMAC-bound to the project, and must agree with the device's signals). The optional visitor cookie is
 * HttpOnly and SameSite=Lax: same-site only, never usable as a third-party cookie, and it carries the same token.
 */
@Controller('v1/identify')
export class IdentifyController {
  private verifyAgent: ReturnType<typeof createAgentVerifier> | null | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly identifyService: IdentifyService,
    private readonly tlsIntel: TlsIntelService,
  ) {}

  private cookieOptions(req: FastifyRequest): CookieOptions {
    return {
      name: this.env.VISITOR_COOKIE_NAME,
      secure: req.protocol === 'https',
      domain: this.env.VISITOR_COOKIE_DOMAIN,
      path: this.env.VISITOR_COOKIE_PATH,
    };
  }

  @Post()
  @HttpCode(200)
  @Auth('public')
  async identify(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<IdentifyResponse> {
    const key = requireAuth(req);
    const parsed = parseIdentifyRequest(req.body);
    if (!parsed.ok) throw ApiError.badRequest(parsed.message);
    const tlsHeader = this.tlsIntel.headerName;
    if (this.verifyAgent === undefined) {
      const dirs = this.env.AGENT_DIRECTORIES.split(',').map((s) => s.trim()).filter(Boolean);
      this.verifyAgent = dirs.includes('off') ? null : createAgentVerifier({ allowedAgents: dirs });
    }
    // Signed AI agents (Web Bot Auth). Skipped quickly when the request carries no signature headers.
    const signedAgent = this.verifyAgent
      ? await this.verifyAgent({ method: req.method, url: `${req.protocol}://${req.host}${req.url}`, headers: req.headers })
      : null;
    const result = await this.identifyService.identify(parsed.value, {
      header: (name) => header(req, name),
      signedAgent,
      key,
      ip: req.ip,
      headers: {
        userAgent: header(req, 'user-agent'),
        secChUa: header(req, 'sec-ch-ua'),
        secChUaPlatform: header(req, 'sec-ch-ua-platform'),
        acceptLanguage: header(req, 'accept-language'),
      },
      cookieToken: this.env.VISITOR_COOKIE ? readVisitorCookie(req.headers.cookie, this.env.VISITOR_COOKIE_NAME) : null,
      tls: tlsHeader ? this.tlsIntel.read(header(req, tlsHeader)) : null,
    });
    if (this.env.VISITOR_COOKIE) void reply.header('Set-Cookie', visitorCookie(result.token, this.cookieOptions(req)));
    return result;
  }

  /** Deletes the visitor cookie (the SDK's disable(true)); the SDK clears its own storage. */
  @Post('forget')
  @HttpCode(204)
  @Auth('public')
  forget(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): void {
    requireAuth(req);
    void reply.header('Set-Cookie', clearedVisitorCookie(this.cookieOptions(req)));
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
