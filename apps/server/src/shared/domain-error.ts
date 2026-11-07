/**
 * Transport-independent error vocabulary for the wish API contract
 * (user-flow-v1 §2-0). Domain and application code throws these; the HTTP
 * layer maps `code` to a status and renders the contract's error body.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'EMAIL_TAKEN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_TRANSITION: 400,
  EMAIL_TAKEN: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
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
