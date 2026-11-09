/**
 * The real FavoriteLookup adapter (card C6): the detail slice's favorited
 * personalization now reads the actual favorites aggregate instead of the
 * C5-time `false` stub. The §2-3 favorited contract (로그인 bool / 비로그인
 * null) is unchanged — C5 already fixed it in unit/e2e; only the adapter
 * behind the port is swapped, as the C5 seam anticipated.
 */
import { FavoriteLookup } from '../../products/application/product-use-cases';
// Value import required: the repository is a DI token (emitDecoratorMetadata
// cannot reflect type-only imports into design:paramtypes).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FavoriteRepository } from '../domain/favorite';

export class FavoriteRepositoryLookup extends FavoriteLookup {
  constructor(private readonly favorites: FavoriteRepository) {
    super();
  }

  async isFavorite(productId: string, memberId: string): Promise<boolean> {
    return this.favorites.exists(memberId, productId);
  }
}
