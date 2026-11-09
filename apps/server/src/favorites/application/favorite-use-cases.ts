/**
 * Application use cases of the favorites slice (§2-4, card C6): favoriting a
 * product (idempotent), unfavoriting (idempotent 204) and listing a member's
 * favorites (최신 찜순, ProductCard projection). They coordinate the Favorite
 * aggregate, its repository port and the Product aggregate's read side; the
 * rules live in the domain objects — this layer only arranges the steps.
 */
import type { Member } from '../../members/domain/member';
import { DomainError } from '../../shared/domain-error';
import {
  Favorite,
  type FavoriteRepository,
} from '../domain/favorite';
import { FavoriteListQuery, favoriteProductField } from '../domain/favorite-list-query';
import {
  toProductCardView,
  type ProductCardView,
} from '../../products/application/product-use-cases';
import type { ProductRepository } from '../../products/domain/product';

/** The NOT_FOUND shared with the detail contract: 존재하지 않음·삭제됨. */
export function favoritedProductMissing(): DomainError {
  return new DomainError(
    'NOT_FOUND',
    '상품을 찾을 수 없어요. 삭제되었거나 만료된 상품일 수 있어요.',
  );
}

// ---------------------------------------------------------------------------
// POST /api/favorites (§2-4) — 201 신규 / 200 이미 찜함(멱등)
// ---------------------------------------------------------------------------

export interface FavoriteResult {
  readonly favorited: boolean;
  /**
   * True when this call created the favorite (the contract's 201 신규),
   * false when the member had already favorited the product (the idempotent
   * 200 이미 찜함). The response body carries only `favorited` — the status
   * code is the contract's observable distinction.
   */
  readonly created: boolean;
}

export class FavoriteProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly favorites: FavoriteRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * `member` is the authenticated principal handed over by the guard —
   * never body input. The product must exist and not be deleted (404,
   * 존재하지 않음·삭제됨); a favorite for an already-favorited product is
   * the contract's idempotent 200, not a duplicate row and not an error
   * (A9: 이중 탭 방지 [추론]).
   */
  async execute(rawProductId: unknown, member: Member): Promise<FavoriteResult> {
    const productId = favoriteProductField(rawProductId);
    const product =
      productId.length > 0 ? await this.products.findById(productId) : null;
    if (product === null || product.isDeleted()) {
      throw favoritedProductMissing();
    }
    const already = await this.favorites.exists(member.id, product.id);
    if (already) {
      return { favorited: true, created: false };
    }
    await this.favorites.save(Favorite.create(member.id, product.id, this.now));
    return { favorited: true, created: true };
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/favorites/{productId} (§2-4) — 204 멱등
// ---------------------------------------------------------------------------

export class UnfavoriteProduct {
  constructor(private readonly favorites: FavoriteRepository) {}

  /**
   * Idempotent by contract: whether the favorite exists or not, the observed
   * outcome is 204 — a stale double-tap or a repeat request must not error
   * (§2-4 lists only 401 as an error). An unknown product id is therefore
   * also a plain 204: there is nothing to remove, which is the same state.
   */
  async execute(productId: string, member: Member): Promise<void> {
    await this.favorites.delete(member.id, productId);
  }
}

// ---------------------------------------------------------------------------
// GET /api/favorites (§2-4) — {items: [ProductCard 최신 찜순], total, …}
// ---------------------------------------------------------------------------

export interface FavoriteListPage {
  readonly items: readonly ProductCardView[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export class ListFavorites {
  constructor(
    private readonly favorites: FavoriteRepository,
    private readonly products: ProductRepository,
  ) {}

  /**
   * The page is cut over the member's favorite rows (최신 찜순) and each row
   * is projected through the products read side. A row whose product can no
   * longer be projected (unknown or soft-deleted) is skipped: AC6.2's 사전
   * 정리 means this should never happen, but a stale row must never render a
   * deleted listing. `total` stays the favorites count — the paging envelope
   * describes the member's favorite list, not the projection survivors.
   */
  async execute(rawQuery: Record<string, unknown>, member: Member): Promise<FavoriteListPage> {
    const query = FavoriteListQuery.parse(rawQuery);
    const page = await this.favorites.pageFor(member.id, query.offset, query.limit);
    const items: ProductCardView[] = [];
    for (const entry of page.entries) {
      const product = await this.products.findById(entry.productId);
      if (product === null || product.isDeleted()) continue;
      items.push(toProductCardView(product));
    }
    return { items, total: page.total, page: query.page, limit: query.limit };
  }
}
