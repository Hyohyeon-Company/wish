/**
 * In-memory MemberRepository adapter. Chosen for this slice (recorded
 * decision): no MySQL binding exists yet for this project, so persistence is
 * a repository port with this adapter; the MySQL adapter replaces it without
 * touching the domain or use cases. The unique-email invariant is enforced
 * here as the store-level guard that a future DB unique index will keep.
 */
import type { Member, MemberRepository } from '../members/domain/member';
import type { EmailAddress } from '../members/domain/member-value-objects';
import { EmailTakenError } from '../members/domain/member-errors';

export class InMemoryMemberRepository implements MemberRepository {
  private readonly byEmail = new Map<string, Member>();
  private readonly byId = new Map<string, Member>();

  async findByEmail(email: EmailAddress): Promise<Member | null> {
    return this.byEmail.get(email.value) ?? null;
  }

  async findById(id: string): Promise<Member | null> {
    return this.byId.get(id) ?? null;
  }

  async save(member: Member): Promise<void> {
    const email = member.email.value;
    const existing = this.byEmail.get(email);
    if (existing !== undefined && existing.id !== member.id) {
      throw new EmailTakenError();
    }
    this.byEmail.set(email, member);
    this.byId.set(member.id, member);
  }
}
