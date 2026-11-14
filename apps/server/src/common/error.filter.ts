import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { type FastifyReply } from 'fastify';
import { toErrorReply } from './error-body.js';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const { status, body, retryAfterSec } = toErrorReply(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : 'Unknown error');
    }
    if (retryAfterSec !== undefined) void reply.header('Retry-After', String(retryAfterSec));
    void reply.status(status).send(body);
  }
}
