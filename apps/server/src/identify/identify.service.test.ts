import { describe, expect, it } from 'vitest';
import { isRetryableTxError } from './identify.service.js';

describe('isRetryableTxError', () => {
  it('retries deadlocks, serialization failures, lock timeouts and P2034', () => {
    for (const err of [
      { code: 'P2034', message: 'Transaction failed due to a write conflict or a deadlock' },
      { message: 'PostgresError { code: "40P01", message: "deadlock detected" }' },
      { message: 'code: "40001" could not serialize access' },
      { message: 'code: "55P03" canceling statement due to lock timeout' },
    ]) {
      expect(isRetryableTxError(err)).toBe(true);
    }
  });

  it('does not retry other failures', () => {
    for (const err of [null, 'x', new Error('unique constraint'), { code: 'P2002', message: 'Unique constraint failed' }]) {
      expect(isRetryableTxError(err)).toBe(false);
    }
  });
});
