/**
 * Bearer token choice for this slice (recorded decision, user-flow §2-5 open
 * item 1): opaque session tokens backed by a server-side store rather than
 * self-contained JWTs. Reasons: logout genuinely revokes the session
 * (AC5.1's logout step is a real state change), expired/unknown tokens fail
 * uniformly with 401, and no signing secret has to be provisioned in CI. The
 * store is in-memory per process in this slice — single-instance v1; the
 * TokenService port moves to a durable store with the MySQL slice.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { TokenService } from '../members/application/auth-use-cases';

interface Session {
  memberId: string;
  expiresAt: number;
}

export const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export class SessionTokenService implements TokenService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async issue(memberId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(this.hash(token), {
      memberId,
      expiresAt: this.now() + this.ttlSeconds * 1000,
    });
    return token;
  }

  async verifyMemberId(token: string | undefined): Promise<string | null> {
    if (typeof token !== 'string' || token.length === 0) return null;
    const session = this.sessions.get(this.hash(token));
    if (session === undefined) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(this.hash(token));
      return null;
    }
    return session.memberId;
  }

  async revoke(token: string): Promise<void> {
    this.sessions.delete(this.hash(token));
  }

  /** Only token digests are stored, so a store leak never yields live tokens. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
