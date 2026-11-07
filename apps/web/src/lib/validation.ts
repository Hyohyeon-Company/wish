/**
 * Client-side validation mirrors of the server's Member value objects
 * (apps/server/src/members/domain/member-value-objects.ts).
 *
 * This duplication is deliberate (double defense, user-flow B6): the client
 * gives immediate feedback, the server stays the authority — every rule here
 * is asserted in unit tests to match the server's messages and bounds, and
 * the server must never be trusted to have been passed.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors = Partial<Record<
  'email' | 'password' | 'nickname' | 'region',
  string
>>;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateEmail(raw: string): string | undefined {
  const value = raw.trim();
  if (value.length === 0) return '이메일을 입력해 주세요.';
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) {
    return '올바른 이메일 주소를 입력해 주세요.';
  }
  return undefined;
}

export function validatePassword(raw: string): string | undefined {
  if (raw.length === 0) return '비밀번호를 입력해 주세요.';
  if (raw.length < 8 || utf8ByteLength(raw) > 72) {
    return '비밀번호는 8자 이상 72바이트 이하로 입력해 주세요.';
  }
  return undefined;
}

export function validateNickname(raw: string): string | undefined {
  const value = raw.trim();
  if (value.length === 0) return '닉네임을 입력해 주세요.';
  if (value.length > 20) return '닉네임은 1자 이상 20자 이하로 입력해 주세요.';
  return undefined;
}

export function validateRegion(raw: string): string | undefined {
  const value = raw.trim();
  if (value.length === 0) return '활동지역을 입력해 주세요.';
  if (value.length > 20) return '활동지역은 1자 이상 20자 이하로 입력해 주세요.';
  return undefined;
}

export interface LoginValues {
  readonly email: string;
  readonly password: string;
}

export interface SignupValues extends LoginValues {
  readonly nickname: string;
  readonly region: string;
}

export function validateLogin(values: LoginValues): FieldErrors {
  const errors: FieldErrors = {};
  const email = validateEmail(values.email);
  const password = validatePassword(values.password);
  if (email !== undefined) errors['email'] = email;
  if (password !== undefined) errors['password'] = password;
  return errors;
}

export function validateSignup(values: SignupValues): FieldErrors {
  const errors: FieldErrors = {};
  const email = validateEmail(values.email);
  const password = validatePassword(values.password);
  const nickname = validateNickname(values.nickname);
  const region = validateRegion(values.region);
  if (email !== undefined) errors['email'] = email;
  if (password !== undefined) errors['password'] = password;
  if (nickname !== undefined) errors['nickname'] = nickname;
  if (region !== undefined) errors['region'] = region;
  return errors;
}
