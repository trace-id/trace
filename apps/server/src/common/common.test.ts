import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error.js';
import { toErrorReply } from './error-body.js';
import { newVisitorId, UUID_V7, uuidv7, uuidv7Time } from './ids.js';

describe('ids', () => {
  it('creates UUIDv7 whose timestamp round-trips to the millisecond', () => {
    const now = new Date('2026-11-14T12:34:56.789Z');
    const id = uuidv7(now);
    expect(id).toMatch(UUID_V7);
    expect(uuidv7Time(id)?.toISOString()).toBe(now.toISOString());
    expect(uuidv7Time('not-a-uuid')).toBeNull();
  });

  it('creates 20-char base62 visitor ids', () => {
    expect(newVisitorId()).toMatch(/^[0-9A-Za-z]{20}$/);
  });
});

describe('toErrorReply', () => {
  it('formats ApiError with Retry-After', () => {
    expect(toErrorReply(ApiError.rateLimited(2.2))).toEqual({
      status: 429,
      body: { error: { code: 'rate_limited', message: 'Too many requests' } },
      retryAfterSec: 3,
    });
  });

  it('maps Nest and Fastify errors to stable codes', () => {
    expect(toErrorReply(new NotFoundException()).body.error.code).toBe('not_found');
    expect(toErrorReply({ statusCode: 413, code: 'FST_ERR_CTP_BODY_TOO_LARGE', message: 'x' })).toEqual({
      status: 413,
      body: { error: { code: 'payload_too_large', message: 'Payload too large' } },
    });
  });

  it('never leaks internals on unknown errors', () => {
    expect(toErrorReply(new Error('db password is hunter2'))).toEqual({
      status: 500,
      body: { error: { code: 'internal_error', message: 'Internal error' } },
    });
  });
});
