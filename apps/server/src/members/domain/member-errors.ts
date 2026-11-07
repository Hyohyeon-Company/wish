/**
 * Business refusals of the member/auth context. Messages are the exact
 * user-facing phrases fixed by the API contract (user-flow-v1 §2-0/§2-1).
 */
import { DomainError } from '../../shared/domain-error';

/** Duplicate signup with an already-registered email (AC5.1) → 409. */
export class EmailTakenError extends DomainError {
  constructor() {
    super('EMAIL_TAKEN', '이미 가입된 이메일이에요.');
    this.name = 'EmailTakenError';
  }
}

/**
 * Login failure with the contract's single generalized message (AC5.2).
 * Unknown email and wrong password are deliberately indistinguishable.
 */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('UNAUTHORIZED', '이메일 또는 비밀번호가 올바르지 않아요.');
    this.name = 'InvalidCredentialsError';
  }
}

/** Protected endpoint without a valid bearer token → 401. */
export class AuthenticationRequiredError extends DomainError {
  constructor() {
    super('UNAUTHORIZED', '로그인이 필요해요.');
    this.name = 'AuthenticationRequiredError';
  }
}
