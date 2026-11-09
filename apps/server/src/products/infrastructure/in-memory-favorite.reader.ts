/**
 * In-memory FavoriteLookup adapter for the detail slice.
 *
 * v1 has no favorites writes yet — card C6 owns the favorites aggregate and
 * the POST/DELETE /api/favorites endpoints — so this adapter's state is empty
 * and a logged-in detail viewer legitimately observes `favorited: false`
 * (no favorite can exist). C6 replaces this adapter behind the same port
 * without touching ReadProductDetail or the §2-3 contract.
 */
import { FavoriteLookup } from '../application/product-use-cases';

export class InMemoryFavoriteReader extends FavoriteLookup {
  async isFavorite(_productId: string, _memberId: string): Promise<boolean> {
    return false;
  }
}
