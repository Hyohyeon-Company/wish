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
import { DomainError } from '../shared/domain-error';
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

/**
 * Optional-auth variant for PUBLIC endpoints that personalize their response
 * when a live bearer token is presented (§2-3 GET /api/products/{id}:
 * favorited 로그인 bool / 비로그인 null). No header → plain guest. A header
 * whose token is unknown, malformed, expired or revoked is ALSO observed as
 * a guest, not a 401 — §3 marks detail-v1 a 공개 화면 whose 401 branch is
 * reserved for authenticated actions (찜, A7), so a stale token must not
 * lock a visitor out of a read they are entitled to make logged out. The
 * stale session itself is still cleaned up by the 401 handler of the next
 * authenticated call. A non-auth failure (repository outage) is rethrown —
 * only the authentication refusal is downgraded to guest.
 */
@Injectable()
export class OptionalCurrentMemberGuard implements CanActivate {
  constructor(private readonly authenticate: AuthenticateMember) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? BEARER_PATTERN.exec(header) : null;
    if (match === null) return true;
    try {
      const token = match[1].trim();
      request.currentMember = await this.authenticate.memberFor(token);
      request.bearerToken = token;
    } catch (error) {
      if (!(error instanceof DomainError && error.code === 'UNAUTHORIZED')) throw error;
    }
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
