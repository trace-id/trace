export type VerifyErrorCode =
  | 'invalid_event_id'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'not_found'
  | 'expired'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_response'
  | 'invalid_label'
  | 'limit_reached';

export class VerifyError extends Error {
  readonly code: VerifyErrorCode;
  readonly status: number | null;
  readonly retryAfterSec: number | null;

  constructor(code: VerifyErrorCode, message: string, status: number | null = null, retryAfterSec: number | null = null) {
    super(message);
    this.name = 'VerifyError';
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}
