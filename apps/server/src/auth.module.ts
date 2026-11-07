import { Module } from '@nestjs/common';
import {
  AuthenticateMember,
  LogInMember,
  SignUpMember,
  TokenService,
} from './members/application/auth-use-cases';
import { MemberRepository, PasswordHasher } from './members/domain/member';
import { AuthController } from './api/auth.controller';
import { CurrentMemberGuard } from './api/current-member.guard';
import { InMemoryMemberRepository } from './infrastructure/in-memory-member.repository';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password-hasher';
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  SessionTokenService,
} from './infrastructure/session-token.service';

function tokenTtlSecondsFromEnv(defaultTtl: number): number {
  const raw = process.env.AUTH_TOKEN_TTL_SECONDS;
  if (raw === undefined || raw.trim() === '') return defaultTtl;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`AUTH_TOKEN_TTL_SECONDS must be a positive integer, got ${raw}`);
  }
  return parsed;
}

@Module({
  controllers: [AuthController],
  providers: [
    { provide: MemberRepository, useClass: InMemoryMemberRepository },
    { provide: PasswordHasher, useClass: BcryptPasswordHasher },
    {
      provide: TokenService,
      useFactory: () =>
        new SessionTokenService(tokenTtlSecondsFromEnv(DEFAULT_TOKEN_TTL_SECONDS)),
    },
    // Explicit factories: the application use cases stay framework-free (no
    // @Injectable), so TypeScript emits no design:paramtypes for them and
    // class-based DI cannot reflect their constructor arguments.
    {
      provide: SignUpMember,
      useFactory: (members: MemberRepository, hasher: PasswordHasher, tokens: TokenService) =>
        new SignUpMember(members, hasher, tokens),
      inject: [MemberRepository, PasswordHasher, TokenService],
    },
    {
      provide: LogInMember,
      useFactory: (members: MemberRepository, hasher: PasswordHasher, tokens: TokenService) =>
        new LogInMember(members, hasher, tokens),
      inject: [MemberRepository, PasswordHasher, TokenService],
    },
    {
      provide: AuthenticateMember,
      useFactory: (members: MemberRepository, tokens: TokenService) =>
        new AuthenticateMember(members, tokens),
      inject: [MemberRepository, TokenService],
    },
    CurrentMemberGuard,
  ],
  exports: [MemberRepository, TokenService, AuthenticateMember],
})
export class AuthModule {}
