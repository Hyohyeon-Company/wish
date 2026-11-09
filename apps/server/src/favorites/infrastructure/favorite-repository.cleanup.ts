/**
 * Adapter serving the products slice's ProductFavoriteCleanup port (the
 * AC6.2 side of deletion) with the favorites slice's repository — the same
 * seam shape as favorite-repository.lookup.ts: the port lives with its
 * consumer (the deletion use case), the implementation stays with the
 * Favorite aggregate's persistence boundary.
 */
import type { ProductFavoriteCleanup } from '../../products/application/product-use-cases';
import type { FavoriteRepository } from '../domain/favorite';

export class FavoriteRepositoryCleanup implements ProductFavoriteCleanup {
  constructor(private readonly favorites: FavoriteRepository) {}

  async removeAllForProduct(productId: string): Promise<number> {
    return this.favorites.removeAllForProduct(productId);
  }
}
