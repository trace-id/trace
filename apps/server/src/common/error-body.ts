import { HttpException } from '@nestjs/common';
import { ApiError } from './api-error.js';

export interface ErrorReply {
  status: number;
  body: { error: { code: string; message: string } };
  retryAfterSec?: number;
}

const FASTIFY_CODES: Record<string, string> = {
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'invalid_request',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'invalid_request',
};

const GENERIC_MESSAGES: Record<string, string> = {
  invalid_request: 'Malformed request',
  payload_too_large: 'Payload too large',
  unsupported_media_type: 'Unsupported content type',
  not_found: 'Not found',
  method_not_allowed: 'Method not allowed',
  request_timeout: 'Request timeout',
};

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'invalid_api_key';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 405:
      return 'method_not_allowed';
    case 408:
      return 'request_timeout';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'invalid_request';
  }
}

/** Internal details never reach the client: 5xx always get a generic message. */
export function toErrorReply(err: unknown): ErrorReply {
  if (err instanceof ApiError) {
    const reply: ErrorReply = { status: err.status, body: { error: { code: err.code, message: err.message } } };
    if (err.retryAfterSec !== undefined) reply.retryAfterSec = err.retryAfterSec;
    return reply;
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code = codeForStatus(status);
    const message = status >= 500 ? 'Internal error' : (GENERIC_MESSAGES[code] ?? err.message);
    return { status, body: { error: { code, message } } };
  }
  const fastify = err as { statusCode?: unknown; code?: unknown; message?: unknown } | null;
  if (fastify && typeof fastify.statusCode === 'number' && fastify.statusCode >= 400 && fastify.statusCode < 500) {
    const code = (typeof fastify.code === 'string' && FASTIFY_CODES[fastify.code]) || codeForStatus(fastify.statusCode);
    const message = GENERIC_MESSAGES[code] ?? 'Malformed request';
    return { status: fastify.statusCode, body: { error: { code, message } } };
  }
  return { status: 500, body: { error: { code: 'internal_error', message: 'Internal error' } } };
}
