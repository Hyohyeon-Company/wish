/**
 * Member aggregate root (brief §6 Member): identity (id), unique email,
 * password_hash, nickname, region, created_at. The entity owns the invariant
 * that a member always carries a stored password *hash* — plaintext never
 * becomes part of a Member; hashing is injected as a domain port.
 */
import { DomainError } from '../../shared/domain-error';
import {
  EmailAddress,
  Nickname,
  PlainPassword,
  Region,
  requireFields,
} from './member-value-objects';

/** Hashing/verification mechanism, provided by infrastructure (bcrypt today). */
export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<string>;
  abstract verify(plain: string, hash: string): Promise<boolean>;
}

/** Persistence boundary of the Member aggregate (adapter provided per env). */
export abstract class MemberRepository {
  abstract findByEmail(email: EmailAddress): Promise<Member | null>;
  abstract findById(id: string): Promise<Member | null>;
  /** Must refuse a second member with the same normalized email (unique invariant). */
  abstract save(member: Member): Promise<void>;
}

export interface MemberSnapshot {
  readonly id: string;
  readonly email: string;
  readonly nickname: string;
  readonly region: string;
  readonly createdAt: Date;
}

export interface SignUpInput {
  readonly email: unknown;
  readonly password: unknown;
  readonly nickname: unknown;
  readonly region: unknown;
}

export class Member {
  private constructor(
    readonly id: string,
    readonly email: EmailAddress,
    readonly passwordHash: string,
    readonly nickname: Nickname,
    readonly region: Region,
    readonly createdAt: Date,
  ) {}

  /**
   * The only way a Member comes into existence: validates every field,
   * hashes the password immediately, and records creation time.
   */
  static async signUp(
    raw: SignUpInput,
    deps: { hasher: PasswordHasher; generateId: () => string; now: () => Date },
  ): Promise<Member> {
    const { email, password, nickname, region } = requireFields((collect) => ({
      email: collect(() => EmailAddress.parse(raw.email)) ?? ({} as EmailAddress),
      password: collect(() => PlainPassword.parse(raw.password)) ?? ({} as PlainPassword),
      nickname: collect(() => Nickname.parse(raw.nickname)) ?? ({} as Nickname),
      region: collect(() => Region.parse(raw.region)) ?? ({} as Region),
    }));
    const passwordHash = await deps.hasher.hash(password.value);
    return new Member(
      deps.generateId(),
      email,
      passwordHash,
      nickname,
      region,
      deps.now(),
    );
  }

  /**
   * Credential check. The caller cannot distinguish "unknown email" from
   * "wrong password" through this method — both yield false.
   */
  async hasPassword(plain: PlainPassword, hasher: PasswordHasher): Promise<boolean> {
    return hasher.verify(plain.value, this.passwordHash);
  }

  toSnapshot(): MemberSnapshot {
    return {
      id: this.id,
      email: this.email.value,
      nickname: this.nickname.value,
      region: this.region.value,
      createdAt: this.createdAt,
    };
  }

  /** Rehydrate a persisted member. Infrastructure-only; do not use for signup. */
  static fromSnapshot(snapshot: {
    id: string;
    email: string;
    passwordHash: string;
    nickname: string;
    region: string;
    createdAt: Date;
  }): Member {
    if (snapshot.passwordHash.length === 0) {
      throw new DomainError('INTERNAL', 'member record without stored password hash');
    }
    return new Member(
      snapshot.id,
      EmailAddress.parse(snapshot.email),
      snapshot.passwordHash,
      Nickname.parse(snapshot.nickname),
      Region.parse(snapshot.region),
      snapshot.createdAt,
    );
  }
}
