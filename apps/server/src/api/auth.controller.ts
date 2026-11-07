/**
 * Auth endpoints, wired 1:1 to the §2-1 API contract draft.
 * Transport validation is deliberately thin: JSON-shape checks only — the
 * domain owns every business rule (user-flow §2-0, domain-design.md).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { MemberView } from '../members/application/auth-use-cases';
// Value imports required: these classes are DI tokens (emitDecoratorMetadata
// cannot reflect type-only imports into design:paramtypes).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  AuthenticateMember,
  LogInMember,
  SignUpMember} from '../members/application/auth-use-cases';
import { DomainError } from '../shared/domain-error';
import { currentMemberView, CurrentMemberGuard } from './current-member.guard';

/** Rejects non-object JSON bodies with the contract's 400 shape. */
function asRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError('VALIDATION_FAILED', '요청 본문을 확인해 주세요.');
  }
  return body as Record<string, unknown>;
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly signUpMember: SignUpMember,
    private readonly logInMember: LogInMember,
    private readonly authenticateMember: AuthenticateMember,
  ) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: unknown): Promise<{ member: MemberView; token: string }> {
    const raw = asRecord(body);
    return this.signUpMember.execute({
      email: raw.email,
      password: raw.password,
      nickname: raw.nickname,
      region: raw.region,
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown): Promise<{ member: MemberView; token: string }> {
    const raw = asRecord(body);
    return this.logInMember.execute({ email: raw.email, password: raw.password });
  }

  @Post('logout')
  @UseGuards(CurrentMemberGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request): Promise<void> {
    await this.authenticateMember.revoke(request.bearerToken);
  }

  @Get('me')
  @UseGuards(CurrentMemberGuard)
  me(@Req() request: Request): { member: MemberView } {
    // The guard already authenticated the token and attached the member.
    return { member: currentMemberView(request) };
  }
}
