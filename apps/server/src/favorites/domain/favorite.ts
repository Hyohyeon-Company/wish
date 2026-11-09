/**
 * Favorite aggregate (brief §5 F6, user-flow §2-4): the fact that one member
 * has favorited one product. The pair (member_id, product_id) is the
 * aggregate's identity — a member has at most one favorite per product, the
 * invariant the §2-4 contract turns into the idempotent POST (201 신규 /
 * 200 이미 찜함). The repository port refuses a duplicate save, so the
 * uniqueness is enforced by the persistence boundary no matter which caller
 * races it; the use case reads `exists` first only to choose the contract's
 * 201-vs-200 status.
 *
 * Invariants owned here:
 * - a favorite always references an existing, non-deleted product — the use
 *   case resolves the product before constructing the aggregate (a deleted
 *   product is the §2-4 404, not a storable favorite);
 * - `favoritedAt` orders the §2-4 GET listing (최신 찜순); the adapter's
 *   insertion sequence is its tie-break, mirroring the product listing.
 *
 * AC6.2 (상품 삭제 시 찜 정리) is a contract duty of deletion: the
 * `removeAllForProduct` operation below is the cleanup step the delete use
 * case (card C7's DELETE /api/products/{id}) must invoke in its own
 * transaction; the repository-level unit tests here are the external judge
 * the contract names. Until C7 lands the endpoint, deletion cannot happen
 * through the API, and the favorites read additionally skips a product that
 * cannot be projected (defense in depth) — a stale row can never render a
 * deleted listing.
 */

export interface FavoriteSnapshot {
  readonly memberId: string;
  readonly productId: string;
  readonly favoritedAt: Date;
}

/**
 * Persistence boundary of the Favorite aggregate (adapter per environment).
 * `save` must refuse a second favorite for the same (memberId, productId)
 * pair — in a SQL adapter this is the unique index; in this slice the
 * in-memory adapter guards it directly.
 */
export abstract class FavoriteRepository {
  abstract save(favorite: Favorite): Promise<void>;
  abstract exists(memberId: string, productId: string): Promise<boolean>;
  /** Idempotent removal; answers whether a row was actually removed. */
  abstract delete(memberId: string, productId: string): Promise<boolean>;
  /**
   * AC6.2 cleanup: removes every favorite of a product. Invoked by the
   * product deletion use case (C7) so a deleted product leaves no favorite
   * rows behind (사전 정리).
   */
  abstract removeAllForProduct(productId: string): Promise<number>;
  /** One page of a member's favorites, 최신 찜순, plus the full total. */
  abstract pageFor(
    memberId: string,
    offset: number,
    limit: number,
  ): Promise<{ entries: readonly FavoriteSnapshot[]; total: number }>;
}

export class Favorite {
  private constructor(
    readonly memberId: string,
    readonly productId: string,
    private readonly favoritedAt: Date,
  ) {}

  /**
   * The only way a Favorite comes into existence. `memberId` is the
   * authenticated principal handed over by the guard — never request input
   * (the same 변조 불가 구조 as the product's seller_id, AC4.4).
   */
  static create(memberId: string, productId: string, now: () => Date): Favorite {
    if (typeof memberId !== 'string' || memberId.length === 0) {
      throw new Error('a Favorite requires its member');
    }
    if (typeof productId !== 'string' || productId.length === 0) {
      throw new Error('a Favorite requires its product');
    }
    return new Favorite(memberId, productId, now());
  }

  toSnapshot(): FavoriteSnapshot {
    return { memberId: this.memberId, productId: this.productId, favoritedAt: this.favoritedAt };
  }

  /** Rehydrate a persisted favorite. Infrastructure-only. */
  static fromSnapshot(snapshot: FavoriteSnapshot): Favorite {
    return new Favorite(snapshot.memberId, snapshot.productId, snapshot.favoritedAt);
  }
}
