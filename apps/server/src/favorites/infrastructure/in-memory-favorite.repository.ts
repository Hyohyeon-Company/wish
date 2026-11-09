/**
 * In-memory FavoriteRepository adapter, same recorded posture as the member
 * and product adapters: no MySQL binding exists yet for this project, so
 * persistence is a repository port with this adapter; the MySQL adapter
 * replaces it without touching the domain or use cases.
 *
 * - the (memberId, productId) pair is unique — `save` refuses a duplicate
 *   (the aggregate invariant, §2-4 멱등 POST; a SQL adapter expresses this
 *   as the unique index);
 * - `pageFor` orders by favoritedAt DESC with the adapter's insertion
 *   sequence as the tie-break (최신 찜순, stable within the same
 *   millisecond — same mechanism as the product listing's latest sort);
 * - `removeAllForProduct` is the AC6.2 cleanup step the product deletion use
 *   case (C7) must invoke.
 */
import type {
  Favorite,
  FavoriteRepository,
  FavoriteSnapshot,
} from '../domain/favorite';

export class InMemoryFavoriteRepository implements FavoriteRepository {
  /** (memberId, productId) → favorite; the key IS the uniqueness guard. */
  private readonly byPair = new Map<string, Favorite>();
  /** Insertion sequence per pair — the adapter's stable ordering tie-break. */
  private readonly insertionOrder = new Map<string, number>();
  private sequence = 0;

  private static key(memberId: string, productId: string): string {
    return `${memberId}\u0000${productId}`;
  }

  async save(favorite: Favorite): Promise<void> {
    const key = InMemoryFavoriteRepository.key(favorite.memberId, favorite.productId);
    if (this.byPair.has(key)) {
      // The §2-4 idempotent POST resolves to 200 before reaching here; a
      // second save attempt is a race the invariant refuses outright.
      throw new Error('a member has at most one favorite per product (unique invariant)');
    }
    this.insertionOrder.set(key, this.sequence++);
    this.byPair.set(key, favorite);
  }

  async exists(memberId: string, productId: string): Promise<boolean> {
    return this.byPair.has(InMemoryFavoriteRepository.key(memberId, productId));
  }

  async delete(memberId: string, productId: string): Promise<boolean> {
    const key = InMemoryFavoriteRepository.key(memberId, productId);
    const existed = this.byPair.delete(key);
    if (existed) this.insertionOrder.delete(key);
    return existed;
  }

  async removeAllForProduct(productId: string): Promise<number> {
    let removed = 0;
    for (const [key, favorite] of [...this.byPair.entries()]) {
      if (favorite.productId !== productId) continue;
      this.byPair.delete(key);
      this.insertionOrder.delete(key);
      removed += 1;
    }
    return removed;
  }

  async pageFor(
    memberId: string,
    offset: number,
    limit: number,
  ): Promise<{ entries: readonly FavoriteSnapshot[]; total: number }> {
    const matching: Array<{ snapshot: FavoriteSnapshot; order: number }> = [];
    for (const favorite of this.byPair.values()) {
      if (favorite.memberId !== memberId) continue;
      matching.push({
        snapshot: favorite.toSnapshot(),
        order: this.insertionOrder.get(
          InMemoryFavoriteRepository.key(favorite.memberId, favorite.productId),
        ) ?? -1,
      });
    }
    // 최신 찜순: newest favoritedAt first, then newest insertion.
    matching.sort(
      (a, b) =>
        b.snapshot.favoritedAt.getTime() - a.snapshot.favoritedAt.getTime() ||
        b.order - a.order,
    );
    return {
      entries: matching.slice(offset, offset + limit).map((entry) => entry.snapshot),
      total: matching.length,
    };
  }
}
