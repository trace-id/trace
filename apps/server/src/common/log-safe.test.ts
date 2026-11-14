import { describe, expect, it } from 'vitest';
import { describeError } from './log-safe.js';

describe('describeError', () => {
  it('never includes the message of a Prisma error', () => {
    const prismaError = Object.assign(new Error('Invalid `prisma.event.create()` ... ip: "203.0.113.9", linkedId: "alice@example.com"'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { modelName: 'Event', target: ['id', 'createdAt'] },
    });
    const text = describeError(prismaError);
    expect(text).toBe('PrismaClientKnownRequestError code=P2002 model=Event target=id,createdAt');
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('alice');
  });

  it('keeps stacks for ordinary errors and handles non-errors', () => {
    expect(describeError(new Error('boom'))).toContain('boom');
    expect(describeError('x')).toBe('Unknown error');
    expect(describeError(null)).toBe('Unknown error');
  });
});
