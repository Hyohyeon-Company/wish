/**
 * Member domain rules in isolation (no HTTP, no Nest): value-object
 * validation, aggregate creation with hash-only credentials, and the
 * repository's unique-email invariant.
 */
import 'reflect-metadata';
import {
  EmailAddress,
  Nickname,
  PlainPassword,
  Region,
  requireFields,
} from '../../src/members/domain/member-value-objects';
import { Member } from '../../src/members/domain/member';
import { DomainError } from '../../src/shared/domain-error';
import { BcryptPasswordHasher } from '../../src/infrastructure/bcrypt-password-hasher';
import { InMemoryMemberRepository } from '../../src/infrastructure/in-memory-member.repository';

const hasher = new BcryptPasswordHasher();
const fixedNow = () => new Date('2026-11-07T09:00:00.000Z');

describe('member value objects', () => {
  it('normalizes emails to the trimmed lowercase identity form', () => {
    expect(EmailAddress.parse('  User@Example.COM ').value).toBe('user@example.com');
  });

  it('rejects malformed emails, short passwords and blank nickname/region as field errors', () => {
    const attempts: Array<[string, () => unknown]> = [
      ['email', () => EmailAddress.parse('not-an-email')],
      ['email', () => EmailAddress.parse(42)],
      ['password', () => PlainPassword.parse('short')],
      ['password', () => PlainPassword.parse(12345678)],
      ['nickname', () => Nickname.parse('   ')],
      ['nickname', () => Nickname.parse(undefined)],
      ['region', () => Region.parse('')],
    ];
    for (const [field, attempt] of attempts) {
      try {
        attempt();
        throw new Error(`expected ${field} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        const domainError = error as DomainError;
        expect(domainError.code).toBe('VALIDATION_FAILED');
        expect(domainError.httpStatus).toBe(400);
        expect(Object.keys(domainError.fields ?? {})).toEqual([field]);
      }
    }
  });

  it('aggregates every invalid field of one signup input into a single 400', async () => {
    expect.assertions(4);
    try {
      await Member.signUp(
        { email: 'nope', password: 'short', nickname: '', region: '' },
        { hasher, generateId: () => 'id-1', now: fixedNow },
      );
      throw new Error('expected validation failure');
    } catch (error) {
      const domainError = error as DomainError;
      expect(domainError.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(domainError.fields ?? {}).sort()).toEqual([
        'email',
        'nickname',
        'password',
        'region',
      ]);
      expect(domainError.fields?.email).toBeTruthy();
      expect(domainError.fields?.password).toBeTruthy();
    }
  });

  it('accepts passwords up to the 72-byte bcrypt input limit and rejects longer ones', () => {
    expect(PlainPassword.parse('x'.repeat(72)).value).toHaveLength(72);
    expect(() => PlainPassword.parse('x'.repeat(73))).toThrow(DomainError);
  });
});

describe('requireFields', () => {
  it('throws the 400 body when any collected field failed', () => {
    expect(() =>
      requireFields((collect) => ({
        a: collect(() => EmailAddress.parse('bad')) ?? ({} as EmailAddress),
        b: collect(() => EmailAddress.parse('good@example.com')) ?? ({} as EmailAddress),
      })),
    ).toThrow(DomainError);
  });
});

describe('Member aggregate', () => {
  it('stores only a bcrypt hash of the password, never the plaintext', async () => {
    const password = 'S3cure-Passw0rd!';
    const member = await Member.signUp(
      { email: 'hash@example.com', password, nickname: '해셔', region: '서울' },
      { hasher, generateId: () => 'member-1', now: fixedNow },
    );
    expect(member.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(member.passwordHash).not.toContain(password);
    expect(await member.hasPassword(PlainPassword.parse(password), hasher)).toBe(true);
    expect(await member.hasPassword(PlainPassword.parse('wrong-password'), hasher)).toBe(false);
    // The serialized snapshot a repository/presenter would see carries no secret.
    expect(JSON.stringify(member.toSnapshot())).not.toContain(password);
    expect(JSON.stringify(member.toSnapshot())).not.toContain('password');
  });

  it('hashes equal passwords of different members differently (salted)', async () => {
    const first = await Member.signUp(
      { email: 'a@example.com', password: 'same-password-1', nickname: '에이', region: '서울' },
      { hasher, generateId: () => 'member-a', now: fixedNow },
    );
    const second = await Member.signUp(
      { email: 'b@example.com', password: 'same-password-1', nickname: '비이', region: '서울' },
      { hasher, generateId: () => 'member-b', now: fixedNow },
    );
    expect(first.passwordHash).not.toBe(second.passwordHash);
  });

  it('keeps identity and profile fields from validated input', async () => {
    const member = await Member.signUp(
      { email: 'Profile@Example.com', password: 'long-enough-pw', nickname: '  위시 유저 ', region: ' 부산 ' },
      { hasher, generateId: () => 'member-2', now: fixedNow },
    );
    expect(member.id).toBe('member-2');
    expect(member.email.value).toBe('profile@example.com');
    expect(member.nickname.value).toBe('위시 유저');
    expect(member.region.value).toBe('부산');
    expect(member.createdAt.toISOString()).toBe('2026-11-07T09:00:00.000Z');
  });
});

describe('member repository unique-email invariant', () => {
  it('refuses a second member with the same normalized email', async () => {
    const members = new InMemoryMemberRepository();
    const first = await Member.signUp(
      { email: 'dup@example.com', password: 'password-123', nickname: '첫째', region: '서울' },
      { hasher, generateId: () => 'member-1', now: fixedNow },
    );
    await members.save(first);
    const second = await Member.signUp(
      { email: 'DUP@example.com', password: 'password-456', nickname: '둘째', region: '부산' },
      { hasher, generateId: () => 'member-2', now: fixedNow },
    );
    await expect(members.save(second)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('rehydrates from a snapshot and keeps working credentials', async () => {
    const created = await Member.signUp(
      { email: 're@example.com', password: 'password-123', nickname: '리', region: '대구' },
      { hasher, generateId: () => 'member-9', now: fixedNow },
    );
    const snapshot = created.toSnapshot();
    const rehydrated = Member.fromSnapshot({
      id: snapshot.id,
      email: snapshot.email,
      passwordHash: created.passwordHash,
      nickname: snapshot.nickname,
      region: snapshot.region,
      createdAt: snapshot.createdAt,
    });
    expect(await rehydrated.hasPassword(PlainPassword.parse('password-123'), hasher)).toBe(true);
    expect(rehydrated.toSnapshot()).toEqual(snapshot);
  });
});
