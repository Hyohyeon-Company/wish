/**
 * Deletion transaction wiring (no database).
 *
 * AC6.2 requires the soft-deleted product write and the favorite cleanup to
 * land together. The adapter achieves that with one MySQL transaction bound to
 * the current async context; these tests assert the wiring itself — both
 * repository calls run on the transaction connection, a failure rolls back,
 * and a nested transaction joins instead of opening a second one.
 */
import { Product } from '../../src/products/domain/product';
import { MysqlProductRepository } from '../../src/products/infrastructure/mysql-product.repository';
import { MysqlDeletionTransaction } from '../../src/products/infrastructure/mysql-deletion-transaction';
import { MysqlFavoriteRepository } from '../../src/favorites/infrastructure/mysql-favorite.repository';
import { FakeSqlClient } from './support/fake-sql-client';

const NOW = new Date('2026-11-10T09:00:00.000Z');

function product(): Product {
  return Product.create(
    {
      title: '원목 식탁',
      price: 120000,
      category_code: 'furniture',
      condition: 'like_new',
      description: '이사 가면서 판매합니다.',
      region: '사당동',
      image_urls: ['http://localhost:3000/uploads/table-1.png'],
    },
    { sellerId: 'seller-1', generateId: () => 'product-1', now: () => NOW },
  );
}

describe('MysqlDeletionTransaction', () => {
  it('runs the product soft-delete and the favorite cleanup in one transaction', async () => {
    const client = new FakeSqlClient(() => ({ affectedRows: 1 }));
    const products = new MysqlProductRepository(client);
    const favorites = new MysqlFavoriteRepository(client);
    const transaction = new MysqlDeletionTransaction(client);

    await transaction.run(async () => {
      await products.trySave(product().markDeleted(NOW), 0);
      await favorites.removeAllForProduct('product-1');
    });

    expect(client.lifecycle).toEqual(['begin:1', 'commit:1']);
    expect(client.statements.map((statement) => statement.scope)).toEqual([
      'transaction',
      'transaction',
    ]);
    expect(client.statements[0].sql).toMatch(/UPDATE products/);
    expect(client.statements[1].sql).toMatch(/DELETE FROM favorites/);
  });

  it('rolls the deletion back when the cleanup fails', async () => {
    const failure = new Error('favorite cleanup failed');
    const client = new FakeSqlClient((sql) =>
      sql.includes('DELETE FROM favorites') ? { error: failure } : { affectedRows: 1 },
    );
    const products = new MysqlProductRepository(client);
    const favorites = new MysqlFavoriteRepository(client);
    const transaction = new MysqlDeletionTransaction(client);

    await expect(
      transaction.run(async () => {
        await products.trySave(product().markDeleted(NOW), 0);
        await favorites.removeAllForProduct('product-1');
      }),
    ).rejects.toBe(failure);

    expect(client.lifecycle).toEqual(['begin:1', 'rollback:1']);
  });

  it('joins an already-open transaction instead of opening a second connection', async () => {
    const client = new FakeSqlClient(() => ({ affectedRows: 1 }));
    const transaction = new MysqlDeletionTransaction(client);

    await client.transaction(async () => {
      await transaction.run(async () => {
        await client.execute('DELETE FROM favorites WHERE product_id = ?', ['product-1']);
      });
    });

    expect(client.lifecycle).toEqual(['begin:1', 'commit:1']);
    expect(client.statements[0].scope).toBe('transaction');
  });
});
