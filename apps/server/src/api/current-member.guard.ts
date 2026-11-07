/**
 * Common bearer-token guard for every protected endpoint (C1 deliverable).
 * Unknown, malformed, expired or revoked tokens all fail uniformly with the
 * contract's 401 UNAUTHORIZED body; a valid token attaches the member and
 * the raw token (needed for logout revocation) to the request.
 */
import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { MemberView } from '../members/application/auth-use-cases';
// Value import required: the class is a DI token (emitDecoratorMetadata
// cannot reflect type-only imports into design:paramtypes).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthenticateMember, toMemberView } from '../members/application/auth-use-cases';
import type { Member } from '../members/domain/member';
import { AuthenticationRequiredError } from '../members/domain/member-errors';

declare module 'express' {
  interface Request {
    currentMember?: Member;
    bearerToken?: string;
  }
}

export const BEARER_PATTERN = /^Bearer\s+(.+)$/;

@Injectable()
export class CurrentMemberGuard implements CanActivate {
  constructor(private readonly authenticate: AuthenticateMember) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? BEARER_PATTERN.exec(header) : null;
    if (match === null) {
      throw new AuthenticationRequiredError();
    }
    const token = match[1].trim();
    request.currentMember = await this.authenticate.memberFor(token);
    request.bearerToken = token;
    return true;
  }
}

export function currentMemberView(request: Request): MemberView {
  const member = request.currentMember;
  if (member === undefined) {
    throw new AuthenticationRequiredError();
  }
  return toMemberView(member);
}
