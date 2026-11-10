/**
 * Member SQL mapping and constraint translation (no database).
 *
 * What matters here is not the SQL text but the contract: a duplicate email
 * must still surface as the API's 409 EMAIL_TAKEN (not a 500), a duplicate
 * nickname must stay inside the contract's validation shape, and a persisted
 * row must rehydrate into a Member whose hash and timestamps survive the round
 * trip.
 */
import { Member, type PasswordHasher } from '../../src/members/domain/member';
import { EmailAddress } from '../../src/members/domain/member-value-objects';
import { EmailTakenError } from '../../src/members/domain/member-errors';
import { DomainError } from '../../src/shared/domain-error';
import { MysqlMemberRepository } from '../../src/infrastructure/mysql/mysql-member.repository';
import { FakeSqlClient } from './support/fake-sql-client';

const hasher: PasswordHasher = {
  hash: async (plain: string) => `hash(${plain})`,
  verify: async () => true,
} as PasswordHasher;

const CREATED_AT = new Date('2026-11-10T09:00:00.000Z');

async function newMember(id = 'member-1'): Promise<Member> {
  return Member.signUp(
    {
      email: 'Seller@Example.com',
      password: 'Str0ng-Pass!',
      nickname: '판매자',
      region: '서울 서초구',
    },
    { hasher, generateId: () => id, now: () => CREATED_AT },
  );
}

function duplicateKeyError(index: string): Error {
  const error = new Error(`Duplicate entry 'x' for key 'members.${index}'`) as Error & {
    code: string;
    errno: number;
    sqlMessage: string;
  };
  error.code = 'ER_DUP_ENTRY';
  error.errno = 1062;
  error.sqlMessage = `Duplicate entry 'x' for key 'members.${index}'`;
  return error;
}

describe('MysqlMemberRepository.save', () => {
  it('inserts the normalized member columns', async () => {
    const client = new FakeSqlClient(() => ({ affectedRows: 1 }));
    const repository = new MysqlMemberRepository(client);
    const member = await newMember();

    await repository.save(member);

    const statement = client.lastStatement(/INSERT INTO members/);
    expect(statement.params).toEqual([
      'member-1',
      'seller@example.com',
      'hash(Str0ng-Pass!)',
      '판매자',
      '서울 서초구',
      CREATED_AT,
    ]);
    expect(statement.scope).toBe('pool');
  });

  it('translates a duplicate email into the contract 409 EMAIL_TAKEN', async () => {
    const client = new FakeSqlClient(() => ({ error: duplicateKeyError('uq_members_email') }));
    const repository = new MysqlMemberRepository(client);

    await expect(repository.save(await newMember())).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('keeps a duplicate nickname inside the validation shape', async () => {
    const client = new FakeSqlClient(() => ({ error: duplicateKeyError('uq_members_nickname') }));
    const repository = new MysqlMemberRepository(client);

    const failure = repository.save(await newMember());
    await expect(failure).rejects.toBeInstanceOf(DomainError);
    await expect(failure).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { nickname: expect.any(String) },
    });
  });

  it('never guesses a business meaning for an unknown constraint', async () => {
    const original = duplicateKeyError('uq_something_else');
    const client = new FakeSqlClient(() => ({ error: original }));
    const repository = new MysqlMemberRepository(client);

    await expect(repository.save(await newMember())).rejects.toBe(original);
  });

  it('re-throws non-duplicate failures unchanged', async () => {
    const original = new Error('connection lost');
    const client = new FakeSqlClient(() => ({ error: original }));
    const repository = new MysqlMemberRepository(client);

    await expect(repository.save(await newMember())).rejects.toBe(original);
  });
});

describe('MysqlMemberRepository reads', () => {
  const row = {
    id: 'member-1',
    email: 'seller@example.com',
    password_hash: 'hash(Str0ng-Pass!)',
    nickname: '판매자',
    region: '서울 서초구',
    created_at: '2026-11-10 09:00:00.000',
  };

  it('rehydrates a member with its UTC timestamp', async () => {
    const client = new FakeSqlClient(() => ({ rows: [row] }));
    const repository = new MysqlMemberRepository(client);

    const member = await repository.findByEmail(EmailAddress.parse('Seller@Example.com'));

    expect(member).not.toBeNull();
    expect(member?.toSnapshot()).toEqual({
      id: 'member-1',
      email: 'seller@example.com',
      nickname: '판매자',
      region: '서울 서초구',
      createdAt: CREATED_AT,
    });
    expect(client.lastStatement(/FROM members WHERE email =/).params).toEqual([
      'seller@example.com',
    ]);
  });

  it('answers null for a member that does not exist', async () => {
    const client = new FakeSqlClient(() => ({ rows: [] }));
    const repository = new MysqlMemberRepository(client);

    await expect(repository.findById('missing')).resolves.toBeNull();
    expect(client.lastStatement(/FROM members WHERE id =/).params).toEqual(['missing']);
  });

  it('refuses a persisted row without a password hash instead of fabricating a member', async () => {
    const client = new FakeSqlClient(() => ({ rows: [{ ...row, password_hash: '' }] }));
    const repository = new MysqlMemberRepository(client);

    await expect(repository.findById('member-1')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
