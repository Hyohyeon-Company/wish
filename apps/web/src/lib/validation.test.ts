/**
 * Client validation mirrors must stay in lockstep with the server's Member
 * value objects (apps/server member-value-objects.ts) — these tests pin the
 * messages and bounds that the double defense shares.
 */
import { describe, expect, it } from 'vitest';
import { utf8ByteLength, validateEmail, validateLogin, validateNickname, validatePassword, validateRegion, validateSignup } from './validation';

describe('field mirrors vs server value objects', () => {
  it('email: required, bounded, format-checked with the server messages', () => {
    expect(validateEmail('')).toBe('이메일을 입력해 주세요.');
    expect(validateEmail('   ')).toBe('이메일을 입력해 주세요.');
    expect(validateEmail('nope')).toBe('올바른 이메일 주소를 입력해 주세요.');
    expect(validateEmail('a@b')).toBe('올바른 이메일 주소를 입력해 주세요.');
    expect(validateEmail('a'.repeat(250) + '@b.com')).toBe('올바른 이메일 주소를 입력해 주세요.');
    expect(validateEmail(' Seller@Example.com ')).toBeUndefined();
  });

  it('password: 8 chars minimum, 72 bytes maximum (bcrypt input limit)', () => {
    expect(validatePassword('')).toBe('비밀번호를 입력해 주세요.');
    expect(validatePassword('short')).toBe('비밀번호는 8자 이상 72바이트 이하로 입력해 주세요.');
    expect(validatePassword('a'.repeat(8))).toBeUndefined();
    expect(validatePassword('가'.repeat(24))).toBeUndefined(); // 72 bytes exactly
    expect(validatePassword('가'.repeat(25))).toBe('비밀번호는 8자 이상 72바이트 이하로 입력해 주세요.'); // 75 bytes
    expect(utf8ByteLength('가')).toBe(3);
  });

  it('nickname: 1..20 chars after trim', () => {
    expect(validateNickname('')).toBe('닉네임을 입력해 주세요.');
    expect(validateNickname('   ')).toBe('닉네임을 입력해 주세요.');
    expect(validateNickname('가'.repeat(21))).toBe('닉네임은 1자 이상 20자 이하로 입력해 주세요.');
    expect(validateNickname(' 판매자 ')).toBeUndefined();
  });

  it('region: 1..20 chars after trim', () => {
    expect(validateRegion('')).toBe('활동지역을 입력해 주세요.');
    expect(validateRegion('나'.repeat(21))).toBe('활동지역은 1자 이상 20자 이하로 입력해 주세요.');
    expect(validateRegion('사당동')).toBeUndefined();
  });
});

describe('form-level validation', () => {
  it('validateLogin collects only email/password', () => {
    expect(validateLogin({ email: '', password: 'short' })).toEqual({
      email: '이메일을 입력해 주세요.',
      password: '비밀번호는 8자 이상 72바이트 이하로 입력해 주세요.',
    });
  });

  it('validateSignup collects all four fields', () => {
    expect(validateSignup({ email: 'nope', password: '', nickname: '', region: '' })).toEqual({
      email: '올바른 이메일 주소를 입력해 주세요.',
      password: '비밀번호를 입력해 주세요.',
      nickname: '닉네임을 입력해 주세요.',
      region: '활동지역을 입력해 주세요.',
    });
  });

  it('valid values produce no errors', () => {
    expect(validateSignup({
      email: 'seller@example.com',
      password: 'Str0ng-Pass!',
      nickname: '판매자',
      region: '서울',
    })).toEqual({});
  });
});
