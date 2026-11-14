export type IdentifyErrorCode =
  | 'collection_disabled'
  | 'timeout'
  | 'network'
  | 'invalid_api_key'
  | 'origin_not_allowed'
  | 'rate_limited'
  | 'bad_request'
  | 'server_error'
  | 'invalid_response';

export class IdentifyError extends Error {
  readonly code: IdentifyErrorCode;
  readonly status: number | null;
  readonly retryAfterSec: number | null;

  constructor(code: IdentifyErrorCode, message: string, status: number | null = null, retryAfterSec: number | null = null) {
    super(message);
    this.name = 'IdentifyError';
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}
