/**
 * Transport-independent error vocabulary for the wish API contract
 * (user-flow-v1 §2-0). Domain and application code throws these; the HTTP
 * layer maps `code` to a status and renders the contract's error body.
 *
 * CONFLICT (409) is card C7's recorded §2-5-5 decision: the contract fixes
 * only "동시 변경 경합 → 한쪽 409" (B10), not the mechanism; the code
 * extends the §2-0 vocabulary minimally so the concurrency loser's body
 * stays in the common `{code, message}` shape.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'EMAIL_TAKEN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'CONFLICT'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_TRANSITION: 400,
  EMAIL_TAKEN: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.fields = fields;
  }

  get httpStatus(): number {
    return STATUS_BY_CODE[this.code];
  }
}
