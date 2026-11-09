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

/**
 * Parses a record of independent fields of any shape and aggregates the
 * failures into the single contract 400 body. `requireProductFields` is the
 * sell-form instance of this generic collector; the listing query reuses it
 * so both request boundaries speak the same error mechanism.
 */
export function requireValidFields<T>(
  read: (collect: <V>(attempt: () => V) => V | undefined) => T,
): T {
  const fields: Record<string, string> = {};
  const collect = <V>(attempt: () => V): V | undefined => {
    try {
      return attempt();
    } catch (error) {
      if (error instanceof FieldValidation) {
        fields[error.field] = error.message;
        return undefined;
      }
      throw error;
    }
  };
  const value = read(collect);
  if (Object.keys(fields).length > 0) {
    throw new DomainError('VALIDATION_FAILED', '입력값을 확인해 주세요.', fields);
  }
  return value;
}
