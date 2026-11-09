/**
 * Field-scoped validation vocabulary of the Product aggregate — the same
 * mechanism the Member aggregate uses (FieldValidation is a VALIDATION_FAILED
 * DomainError, so even a lone field failure already renders the contract 400;
 * the sell form aggregates several into one body via requireProductFields).
 */
import { DomainError } from '../../shared/domain-error';

export class FieldValidation extends DomainError {
  readonly field: string;

  constructor(field: string, message: string) {
    super('VALIDATION_FAILED', message, { [field]: message });
    this.name = 'FieldValidation';
    this.field = field;
  }
}

export function fieldFailure(field: string, message: string): never {
  throw new FieldValidation(field, message);
}
