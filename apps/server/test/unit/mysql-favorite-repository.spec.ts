/**
 * Favorite SQL mapping (no database): the (member, product) pair is the
 * identity, the idempotent POST absorbs a concurrent duplicate, 최신 찜순 is
 * ordered in SQL, and the AC6.2 cleanup deletes by product.
 */
import { Favorite } from '../../src/favorites/domain/favorite';
import { MysqlFavoriteRepository } from '../../src/favorites/infrastructure/mysql-favorite.repository';
import { FakeSqlClient } from './support/fake-sql-client';

const AT = new Date('2026-11-10T09:00:00.000Z');

const favorite = (): Favorite => Favorite.create('member-1', 'product-1', () => AT);

function duplicateKeyError(): Error {
  const error = new Error("Duplicate entry 'x' for key 'favorites.PRIMARY'") as Error & {
    code: string;
    sqlMessage: string;
  };
  error.code = 'ER_DUP_ENTRY';
  error.sqlMessage = error.message;
  return error;
}

describe('MysqlFavoriteRepository', () => {
  it('inserts the pair with its timestamp', async () => {
    const client = new FakeSqlClient(() => ({ affectedRows: 1 }));
    const repository = new MysqlFavoriteRepository(client);

    await repository.save(favorite());

    expect(client.lastStatement(/INSERT INTO favorites/).params).toEqual([
      'member-1',
      'product-1',
      AT,
    ]);
  });

  it('absorbs a concurrent duplicate as the idempotent POST the contract defines', async () => {
    const client = new FakeSqlClient(() => ({ error: duplicateKeyError() }));
    const repository = new MysqlFavoriteRepository(client);

    await expect(repository.save(favorite())).resolves.toBeUndefined();
  });

  it('re-throws any other write failure', async () => {
    const failure = new Error('foreign key violation');
    const client = new FakeSqlClient(() => ({ error: failure }));
    const repository = new MysqlFavoriteRepository(client);

    await expect(repository.save(favorite())).rejects.toBe(failure);
  });

  it('answers exists from the row presence', async () => {
    const present = new FakeSqlClient(() => ({ rows: [{ present: 1 }] }));
    await expect(
      new MysqlFavoriteRepository(present).exists('member-1', 'product-1'),
    ).resolves.toBe(true);

    const absent = new FakeSqlClient(() => ({ rows: [] }));
    await expect(
      new MysqlFavoriteRepository(absent).exists('member-1', 'product-1'),
    ).resolves.toBe(false);
  });

  it('reports whether an unfavorite actually removed a row', async () => {
    const removed = new FakeSqlClient(() => ({ affectedRows: 1 }));
    await expect(
      new MysqlFavoriteRepository(removed).delete('member-1', 'product-1'),
    ).resolves.toBe(true);

    const nothing = new FakeSqlClient(() => ({ affectedRows: 0 }));
    await expect(
      new MysqlFavoriteRepository(nothing).delete('member-1', 'product-1'),
    ).resolves.toBe(false);
  });

  it('cleans every favorite of a product (AC6.2) and reports the count', async () => {
    const client = new FakeSqlClient(() => ({ affectedRows: 3 }));
    const repository = new MysqlFavoriteRepository(client);

    await expect(repository.removeAllForProduct('product-1')).resolves.toBe(3);
    expect(client.lastStatement(/DELETE FROM favorites WHERE product_id =/).params).toEqual([
      'product-1',
    ]);
  });

  it('pages a member favorites newest-first with the stable tie-break', async () => {
    const client = new FakeSqlClient((sql) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 7 }] };
      return {
        rows: [
          { product_id: 'product-2', favorited_at: '2026-11-10 10:00:00.000' },
          { product_id: 'product-1', favorited_at: '2026-11-10 09:00:00.000' },
        ],
      };
    });
    const repository = new MysqlFavoriteRepository(client);

    const page = await repository.pageFor('member-1', 24, 5);

    expect(page.total).toBe(7);
    expect(page.entries).toEqual([
      { memberId: 'member-1', productId: 'product-2', favoritedAt: new Date('2026-11-10T10:00:00.000Z') },
      { memberId: 'member-1', productId: 'product-1', favoritedAt: AT },
    ]);
    const listStatement = client.lastStatement(
      /FROM favorites\s+WHERE member_id = \? ORDER BY/,
    );
    expect(listStatement.sql.replace(/\s+/g, ' ')).toContain(
      'ORDER BY favorited_at DESC, seq DESC LIMIT ? OFFSET ?',
    );
    expect(listStatement.params).toEqual(['member-1', 5, 24]);
  });
});
