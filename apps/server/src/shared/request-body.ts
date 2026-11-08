/** Rejects non-object JSON bodies with the contract's 400 shape (§2-0). */
import { DomainError } from './domain-error';

export function asRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError('VALIDATION_FAILED', '요청 본문을 확인해 주세요.');
  }
  return body as Record<string, unknown>;
}
