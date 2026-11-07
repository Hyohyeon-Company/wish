/**
 * Application use cases of the member/auth context. They coordinate the
 * Member aggregate, the repository port and the token port; business rules
 * (validation, uniqueness, credential checking, generalized failure) stay in
 * the domain objects.
 */
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../shared/domain-error';
import type { MemberRepository, PasswordHasher, SignUpInput } from '../domain/member';
import { Member } from '../domain/member';
import { EmailAddress, PlainPassword, requireFields } from '../domain/member-value-objects';
import { EmailTakenError, InvalidCredentialsError } from '../domain/member-errors';

/** Public member projection — the contract's `member` object. Never a hash. */
export interface MemberView {
  readonly id: string;
  readonly email: string;
  readonly nickname: string;
  readonly region: string;
  readonly created_at: string;
}

export function toMemberView(member: Member): MemberView {
  const snapshot = member.toSnapshot();
  return {
    id: snapshot.id,
    email: snapshot.email,
    nickname: snapshot.nickname,
    region: snapshot.region,
    created_at: snapshot.createdAt.toISOString(),
  };
}

export interface AuthenticatedResult {
  readonly member: MemberView;
  readonly token: string;
}

/** Issues and later invalidates bearer tokens (port; adapter per environment). */
export abstract class TokenService {
  abstract issue(memberId: string): Promise<string>;
  /** Member id for a live token, or null for unknown/expired/revoked tokens. */
  abstract verifyMemberId(token: string | undefined): Promise<string | null>;
  abstract revoke(token: string): Promise<void>;
}

export class SignUpMember {
  constructor(
    private readonly members: MemberRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(raw: SignUpInput): Promise<AuthenticatedResult> {
    // Validation happens inside Member.signUp; run it before the uniqueness
    // check so field errors are reported even for duplicate-email requests.
    const member = await Member.signUp(raw, {
      hasher: this.hasher,
      generateId: () => randomUUID(),
      now: this.now,
    });
    if ((await this.members.findByEmail(member.email)) !== null) {
      throw new EmailTakenError();
    }
    await this.members.save(member);
    return { member: toMemberView(member), token: await this.tokens.issue(member.id) };
  }
}

export class LogInMember {
  constructor(
    private readonly members: MemberRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  async execute(raw: { email: unknown; password: unknown }): Promise<AuthenticatedResult> {
    const { email, password } = requireFields((collect) => ({
      email: collect(() => EmailAddress.parse(raw.email)) ?? ({} as EmailAddress),
      password: collect(() => PlainPassword.parse(raw.password)) ?? ({} as PlainPassword),
    }));
    const member = await this.members.findByEmail(email);
    const ok = member !== null && (await member.hasPassword(password, this.hasher));
    if (!ok || member === null) {
      // One generalized refusal for both unknown email and wrong password.
      throw new InvalidCredentialsError();
    }
    return { member: toMemberView(member), token: await this.tokens.issue(member.id) };
  }
}

/** Re-authentication of a bearer token for `me`/`logout` style endpoints. */
export class AuthenticateMember {
  constructor(
    private readonly members: MemberRepository,
    private readonly tokens: TokenService,
  ) {}

  async memberFor(token: string | undefined): Promise<Member> {
    const memberId = await this.tokens.verifyMemberId(token);
    const member = memberId === null ? null : await this.members.findById(memberId);
    if (memberId === null || member === null) {
      throw new DomainError('UNAUTHORIZED', '로그인이 필요해요.');
    }
    return member;
  }

  /** Ends the session behind a bearer token (logout, AC5.1). */
  async revoke(token: string | undefined): Promise<void> {
    if (typeof token === 'string' && token.length > 0) {
      await this.tokens.revoke(token);
    }
  }
}
