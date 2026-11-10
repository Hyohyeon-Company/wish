/**
 * MySQL adapter of the Favorite aggregate's repository port.
 *
 * The (member_id, product_id) primary key is the uniqueness invariant the
 * in-memory adapter guards with its map key. A concurrent duplicate INSERT —
 * the only way to reach the insert with a pair that already exists, since the
 * use case reads `exists` first — is absorbed here instead of surfacing a 500:
 * the §2-4 contract makes POST /api/favorites idempotent (201 신규 / 200 이미
 * 찜함), so "the pair already exists" has a defined observable outcome and the
 * invariant itself still holds in the database.
 *
 * `pageFor` orders `favorited_at DESC, seq DESC` — the same stable 최신 찜순
 * as the in-memory adapter's insertion sequence.
 */
import type {
  Favorite,
  FavoriteRepository,
  FavoriteSnapshot,
} from '../domain/favorite';
import { isDuplicateEntryError, toDate, toNumber } from '../../infrastructure/mysql/mysql-support';
import type { SqlClient } from '../../infrastructure/mysql/sql-client';

const INSERT_FAVORITE =
  'INSERT INTO favorites (member_id, product_id, favorited_at) VALUES (?, ?, ?)';
const SELECT_FAVORITE_EXISTS =
  'SELECT 1 AS present FROM favorites WHERE member_id = ? AND product_id = ? LIMIT 1';
const DELETE_FAVORITE =
  'DELETE FROM favorites WHERE member_id = ? AND product_id = ?';
const DELETE_FAVORITES_FOR_PRODUCT = 'DELETE FROM favorites WHERE product_id = ?';
const SELECT_FAVORITE_PAGE = `SELECT product_id, favorited_at FROM favorites
  WHERE member_id = ? ORDER BY favorited_at DESC, seq DESC LIMIT ? OFFSET ?`;
const COUNT_FAVORITES = 'SELECT COUNT(*) AS total FROM favorites WHERE member_id = ?';

interface FavoritePageRow {
  readonly product_id: string;
  readonly favorited_at: unknown;
}

export class MysqlFavoriteRepository implements FavoriteRepository {
  constructor(private readonly client: SqlClient) {}

  async save(favorite: Favorite): Promise<void> {
    const snapshot = favorite.toSnapshot();
    try {
      await this.client.execute(INSERT_FAVORITE, [
        snapshot.memberId,
        snapshot.productId,
        snapshot.favoritedAt,
      ]);
    } catch (error) {
      // Idempotent POST (§2-4): the pair already exists, the unique index held.
      if (isDuplicateEntryError(error)) return;
      throw error;
    }
  }

  async exists(memberId: string, productId: string): Promise<boolean> {
    const rows = await this.client.query<{ present: unknown }>(SELECT_FAVORITE_EXISTS, [
      memberId,
      productId,
    ]);
    return rows.length > 0;
  }

  async delete(memberId: string, productId: string): Promise<boolean> {
    return (await this.client.execute(DELETE_FAVORITE, [memberId, productId])) > 0;
  }

  /** AC6.2 cleanup: the deletion use case calls this inside its transaction. */
  async removeAllForProduct(productId: string): Promise<number> {
    return this.client.execute(DELETE_FAVORITES_FOR_PRODUCT, [productId]);
  }

  async pageFor(
    memberId: string,
    offset: number,
    limit: number,
  ): Promise<{ entries: readonly FavoriteSnapshot[]; total: number }> {
    const rows = await this.client.query<FavoritePageRow>(SELECT_FAVORITE_PAGE, [
      memberId,
      limit,
      offset,
    ]);
    const totals = await this.client.query<{ total: unknown }>(COUNT_FAVORITES, [memberId]);
    if (totals.length === 0) throw new Error('favorites count returned no row');
    return {
      entries: rows.map((row) => ({
        memberId,
        productId: row.product_id,
        favoritedAt: toDate(row.favorited_at, 'favorites.favorited_at'),
      })),
      total: toNumber(totals[0].total, 'favorites.total'),
    };
  }
}
