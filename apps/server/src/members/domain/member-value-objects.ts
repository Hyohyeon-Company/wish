/**
 * Value objects of the Member aggregate. Each is deliberately hard to
 * construct invalidly: parsing either yields a normalized valid value or a
 * field-scoped validation failure the signup/login flows aggregate.
 */
import { DomainError } from '../../shared/domain-error';

/**
 * A single field-level validation failure. It is itself a VALIDATION_FAILED
 * DomainError, so a lone field failure already renders the contract 400;
 * input parsers may instead aggregate several into one body via requireFields.
 */
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email address, normalized to the lowercased trimmed form used for identity. */
export class EmailAddress {
  private constructor(readonly value: string) {}

  static parse(raw: unknown): EmailAddress {
    if (typeof raw !== 'string') {
      fieldFailure('email', '이메일을 입력해 주세요.');
    }
    const value = raw.trim().toLowerCase();
    if (value.length === 0 || value.length > 254 || !EMAIL_PATTERN.test(value)) {
      fieldFailure('email', '올바른 이메일 주소를 입력해 주세요.');
    }
    return new EmailAddress(value);
  }
}

/**
 * Password as typed by the member. Length bounds are a recorded backend
 * decision for this slice: 8 characters minimum, 72 bytes maximum (the
 * bcrypt input limit). The entity never keeps the plain value.
 */
export class PlainPassword {
  private constructor(readonly value: string) {}

  static parse(raw: unknown): PlainPassword {
    if (typeof raw !== 'string') {
      fieldFailure('password', '비밀번호를 입력해 주세요.');
    }
    const bytes = Buffer.byteLength(raw, 'utf8');
    if (raw.length < 8 || bytes > 72) {
      fieldFailure('password', '비밀번호는 8자 이상 72바이트 이하로 입력해 주세요.');
    }
    return new PlainPassword(raw);
  }
}

export class Nickname {
  private constructor(readonly value: string) {}

  static parse(raw: unknown): Nickname {
    if (typeof raw !== 'string') {
      fieldFailure('nickname', '닉네임을 입력해 주세요.');
    }
    const value = raw.trim();
    if (value.length < 1 || value.length > 20) {
      fieldFailure('nickname', '닉네임은 1자 이상 20자 이하로 입력해 주세요.');
    }
    return new Nickname(value);
  }
}

export class Region {
  private constructor(readonly value: string) {}

  static parse(raw: unknown): Region {
    if (typeof raw !== 'string') {
      fieldFailure('region', '활동지역을 입력해 주세요.');
    }
    const value = raw.trim();
    if (value.length < 1 || value.length > 20) {
      fieldFailure('region', '활동지역은 1자 이상 20자 이하로 입력해 주세요.');
    }
    return new Region(value);
  }
}

/** Aggregates field failures of one input parse into the 400 contract body. */
export function requireFields<T>(
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
