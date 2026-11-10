/**
 * MySQL adapter of the Member aggregate's repository port.
 *
 * The in-memory adapter is the previous slice's store; this one keeps the same
 * contract and adds the persistence-level guards the schema owns:
 *
 * - `uq_members_email` — the unique-email invariant (AC5.1). A losing race
 *   still surfaces as the contract's 409 `EMAIL_TAKEN`, exactly like the
 *   in-memory store's duplicate check.
 * - `uq_members_nickname` — the nickname uniqueness the MySQL schema slice
 *   asked for. The API contract (user-flow §2-1) defines no duplicate-nickname
 *   case, so the violation is rendered as the contract's existing
 *   `VALIDATION_FAILED` (400 with `fields.nickname`) rather than a 500 or a new
 *   error code. Recorded open item: if nickname uniqueness should be a
 *   user-visible rule, Planner/Leader must confirm its message and status.
 * - any other unique violation is re-thrown untouched, never guessed into a
 *   business meaning.
 */
import { Member, type MemberRepository } from '../../members/domain/member';
import { EmailTakenError } from '../../members/domain/member-errors';
import type { EmailAddress } from '../../members/domain/member-value-objects';
import { DomainError } from '../../shared/domain-error';
import { duplicateKeyName, isDuplicateEntryError, toDate } from './mysql-support';
import type { SqlClient } from './sql-client';

const EMAIL_UNIQUE_INDEX = 'uq_members_email';
const NICKNAME_UNIQUE_INDEX = 'uq_members_nickname';
const NICKNAME_TAKEN_MESSAGE = '이미 사용 중인 닉네임이에요.';

const MEMBER_COLUMNS = 'id, email, password_hash, nickname, region, created_at';

const SELECT_MEMBER_BY_EMAIL = `SELECT ${MEMBER_COLUMNS} FROM members WHERE email = ? LIMIT 1`;
const SELECT_MEMBER_BY_ID = `SELECT ${MEMBER_COLUMNS} FROM members WHERE id = ? LIMIT 1`;
const INSERT_MEMBER = `INSERT INTO members (${MEMBER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`;

interface MemberRow {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly nickname: string;
  readonly region: string;
  readonly created_at: unknown;
}

export function toMember(row: MemberRow): Member {
  return Member.fromSnapshot({
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    nickname: row.nickname,
    region: row.region,
    createdAt: toDate(row.created_at, 'members.created_at'),
  });
}

export class MysqlMemberRepository implements MemberRepository {
  constructor(private readonly client: SqlClient) {}

  async findByEmail(email: EmailAddress): Promise<Member | null> {
    const rows = await this.client.query<MemberRow>(SELECT_MEMBER_BY_EMAIL, [email.value]);
    return rows.length === 0 ? null : toMember(rows[0]);
  }

  async findById(id: string): Promise<Member | null> {
    const rows = await this.client.query<MemberRow>(SELECT_MEMBER_BY_ID, [id]);
    return rows.length === 0 ? null : toMember(rows[0]);
  }

  async save(member: Member): Promise<void> {
    try {
      await this.client.execute(INSERT_MEMBER, [
        member.id,
        member.email.value,
        member.passwordHash,
        member.nickname.value,
        member.region.value,
        member.createdAt,
      ]);
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      switch (duplicateKeyName(error)) {
        case EMAIL_UNIQUE_INDEX:
          throw new EmailTakenError();
        case NICKNAME_UNIQUE_INDEX:
          throw new DomainError('VALIDATION_FAILED', NICKNAME_TAKEN_MESSAGE, {
            nickname: NICKNAME_TAKEN_MESSAGE,
          });
        default:
          // Unknown index: the constraint is not one this adapter understands,
          // so it must not be translated into a business refusal.
          throw error;
      }
    }
  }
}
