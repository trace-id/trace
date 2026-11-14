export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, code = 'invalid_request'): ApiError {
    return new ApiError(400, code, message);
  }

  static unauthorized(message = 'Missing or invalid API key'): ApiError {
    return new ApiError(401, 'invalid_api_key', message);
  }

  static forbidden(code: string, message: string): ApiError {
    return new ApiError(403, code, message);
  }

  /** Used for both "missing" and "belongs to another project", so ids cannot be probed. */
  static notFound(message = 'Not found'): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  static rateLimited(retryAfterSec: number): ApiError {
    return new ApiError(429, 'rate_limited', 'Too many requests', Math.max(1, Math.ceil(retryAfterSec)));
  }
}
