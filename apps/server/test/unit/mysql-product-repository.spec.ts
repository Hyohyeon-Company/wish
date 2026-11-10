/**
 * Product SQL mapping, listing translation and optimistic concurrency
 * (no database).
 *
 * These checks cover the behaviour the in-memory adapter provides in
 * JavaScript and the SQL adapter must reproduce in SQL: soft-deleted rows are
 * invisible, filters combine, "최신순" is stable, the keyword is literal, and a
 * lost version race answers false (the caller's 409) instead of overwriting.
 */
import { Product } from '../../src/products/domain/product';
import { ProductListingQuery } from '../../src/products/domain/product-listing';
import { MyProductsQuery } from '../../src/products/domain/my-products-query';
import {
  MysqlProductRepository,
  escapeLikePattern,
} from '../../src/products/infrastructure/mysql-product.repository';
import { FakeSqlClient, type FakeResponse } from './support/fake-sql-client';

const NOW = new Date('2026-11-10T09:00:00.000Z');

const SELL_FORM = {
  title: '원목 식탁',
  price: 120000,
  category_code: 'furniture',
  condition: 'like_new',
  description: '이사 가면서 판매합니다.',
  region: '사당동',
  image_urls: [
    'http://localhost:3000/uploads/table-1.png',
    'http://localhost:3000/uploads/table-2.png',
  ],
};

function sampleProduct(options: { deletedAt?: Date; version?: number } = {}): Product {
  const created = Product.create(SELL_FORM, {
    sellerId: 'seller-1',
    generateId: () => 'product-1',
    now: () => NOW,
  });
  return Product.fromSnapshot({
    ...created.toSnapshot(),
    deletedAt: options.deletedAt ?? null,
    version: options.version ?? 0,
  });
}

const PRODUCT_ROW = {
  id: 'product-1',
  seller_id: 'seller-1',
  title: '원목 식탁',
  description: '이사 가면서 판매합니다.',
  price: '120000',
  category_code: 'furniture',
  condition_code: 'like_new',
  region: '사당동',
  status: 'ACTIVE',
  created_at: '2026-11-10 09:00:00.000',
  updated_at: '2026-11-10 09:00:00.000',
  deleted_at: null,
  version: '2',
};

const IMAGE_ROWS = [
  { product_id: 'product-1', url: '/uploads/table-1.png', sort_order: 1 },
  { product_id: 'product-1', url: '/uploads/table-2.png', sort_order: 2 },
];

function readerClient(
  responses: { readonly products?: FakeResponse; readonly total?: FakeResponse } = {},
): FakeSqlClient {
  return new FakeSqlClient((sql) => {
    if (sql.includes('FROM product_images')) return { rows: IMAGE_ROWS };
    if (sql.includes('SELECT COUNT(*) AS total FROM products')) {
      return responses.total ?? { rows: [{ total: 1 }] };
    }
    if (sql.includes('FROM products p')) return responses.products ?? { rows: [PRODUCT_ROW] };
    return undefined;
  });
}

describe('escapeLikePattern', () => {
  it('makes a user keyword literal instead of a wildcard', () => {
    expect(escapeLikePattern('50% off')).toBe('50\\% off');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('c:\\path')).toBe('c:\\\\path');
    expect(escapeLikePattern('원목 식탁')).toBe('원목 식탁');
  });
});

describe('MysqlProductRepository.save', () => {
  it('writes the listing and its images in one transaction', async () => {
    const client = new FakeSqlClient(() => ({ affectedRows: 1 }));
    const repository = new MysqlProductRepository(client);

    await repository.save(sampleProduct());

    expect(client.lifecycle).toEqual(['begin:1', 'commit:1']);
    const product = client.lastStatement(/INSERT INTO products/);
    expect(product.scope).toBe('transaction');
    expect(product.params).toEqual([
      'product-1',
      'seller-1',
      '원목 식탁',
      '이사 가면서 판매합니다.',
      120000,
      'furniture',
      'like_new',
      '사당동',
      'ACTIVE',
      NOW,
      NOW,
      null,
      0,
    ]);
    const images = client.lastStatement(/INSERT INTO product_images/);
    expect(images.scope).toBe('transaction');
    expect(images.params).toEqual([
      'product-1',
      'http://localhost:3000/uploads/table-1.png',
      1,
      'product-1',
      'http://localhost:3000/uploads/table-2.png',
      2,
    ]);
  });

  it('rolls the listing back when its images cannot be written', async () => {
    const failure = new Error('images insert failed');
    const client = new FakeSqlClient((sql) =>
      sql.includes('INSERT INTO product_images') ? { error: failure } : { affectedRows: 1 },
    );
    const repository = new MysqlProductRepository(client);

    await expect(repository.save(sampleProduct())).rejects.toBe(failure);
    expect(client.lifecycle).toEqual(['begin:1', 'rollback:1']);
  });
});

describe('MysqlProductRepository.findById', () => {
  it('maps the row and its ordered images', async () => {
    const client = readerClient();
    const repository = new MysqlProductRepository(client);

    const product = await repository.findById('product-1');

    expect(product).not.toBeNull();
    expect(product?.toSnapshot()).toEqual({
      id: 'product-1',
      sellerId: 'seller-1',
      title: '원목 식탁',
      description: '이사 가면서 판매합니다.',
      price: 120000,
      categoryCode: 'furniture',
      condition: 'like_new',
      region: '사당동',
      status: 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      images: [
        { url: '/uploads/table-1.png', sortOrder: 1 },
        { url: '/uploads/table-2.png', sortOrder: 2 },
      ],
      version: 2,
    });
  });

  it('keeps a soft-deleted row readable for the 404 decision', async () => {
    const client = readerClient({
      products: { rows: [{ ...PRODUCT_ROW, deleted_at: '2026-11-10 10:00:00.000' }] },
    });
    const repository = new MysqlProductRepository(client);

    const product = await repository.findById('product-1');

    expect(product?.isDeleted()).toBe(true);
  });

  it('answers null when the row is missing', async () => {
    const client = readerClient({ products: { rows: [] } });
    const repository = new MysqlProductRepository(client);

    await expect(repository.findById('missing')).resolves.toBeNull();
  });
});

describe('MysqlProductRepository.trySave', () => {
  it('updates only when the stored version still matches', async () => {
    const client = new FakeSqlClient(() => ({ affectedRows: 1 }));
    const repository = new MysqlProductRepository(client);
    const next = sampleProduct({ version: 1 });

    await expect(repository.trySave(next, 1)).resolves.toBe(true);

    const statement = client.lastStatement(/UPDATE products/);
    expect(statement.sql.replace(/\s+/g, ' ')).toContain(
      'SET status = ?, updated_at = ?, deleted_at = ?, version = version + 1 WHERE id = ? AND version = ?',
    );
    expect(statement.params).toEqual(['ACTIVE', NOW, null, 'product-1', 1]);
  });

  it('answers false when another writer already moved the version', async () => {
    const client = new FakeSqlClient(() => ({ affectedRows: 0 }));
    const repository = new MysqlProductRepository(client);

    await expect(repository.trySave(sampleProduct(), 0)).resolves.toBe(false);
  });
});

describe('MysqlProductRepository.list', () => {
  it('excludes deleted rows, orders newest-first and pages in SQL', async () => {
    const client = readerClient();
    const repository = new MysqlProductRepository(client);
    const query = ProductListingQuery.parse({ page: '2', limit: '5' });

    const page = await repository.list(query);

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    const listing = client.lastStatement(/FROM products p WHERE .*LIMIT \? OFFSET \?/);
    expect(listing.sql.replace(/\s+/g, ' ')).toContain(
      'ORDER BY p.created_at DESC, p.seq DESC LIMIT ? OFFSET ?',
    );
    expect(listing.params).toEqual([5, 5]);
  });

  it('binds a literal keyword and combines every filter', async () => {
    const client = readerClient();
    const repository = new MysqlProductRepository(client);
    const query = ProductListingQuery.parse({
      q: '50% 원목',
      category: 'furniture',
      min_price: '10000',
      max_price: '200000',
      status: 'RESERVED',
      region: '사당동',
      sort: 'price_asc',
    });

    await repository.list(query);

    const listing = client.lastStatement(/FROM products p WHERE .*LIMIT \? OFFSET \?/);
    expect(listing.sql.replace(/\s+/g, ' ')).toContain('p.title LIKE ?');
    expect(listing.sql).toContain('p.category_code = ?');
    expect(listing.sql).toContain('p.price >= ?');
    expect(listing.sql).toContain('p.price <= ?');
    expect(listing.sql).toContain('p.status = ?');
    expect(listing.sql).toContain('p.region = ?');
    expect(listing.sql).toContain('ORDER BY p.price ASC, p.created_at DESC, p.seq DESC');
    expect(listing.params).toEqual([
      '%50\\% 원목%',
      'furniture',
      10000,
      200000,
      'RESERVED',
      '사당동',
      24,
      0,
    ]);
  });

  it('asks for images only for the rows on the page', async () => {
    const client = readerClient();
    const repository = new MysqlProductRepository(client);

    await repository.list(ProductListingQuery.parse({}));
    await repository.list(ProductListingQuery.parse({ page: '9' }));

    const imageQueries = client.statementsMatching(/FROM product_images/);
    expect(imageQueries).toHaveLength(2);
    expect(imageQueries[0].params).toEqual(['product-1']);
  });

  it('issues no image query for an empty page', async () => {
    const client = readerClient({
      products: { rows: [] },
      total: { rows: [{ total: 0 }] },
    });
    const repository = new MysqlProductRepository(client);

    const page = await repository.list(ProductListingQuery.parse({ page: '4' }));

    expect(page).toEqual({ items: [], total: 0 });
    expect(client.statementsMatching(/FROM product_images/)).toHaveLength(0);
  });
});

describe('MysqlProductRepository.listBySeller', () => {
  it('scopes the read to the seller and keeps deleted rows out', async () => {
    const client = readerClient();
    const repository = new MysqlProductRepository(client);

    await repository.listBySeller('seller-1', MyProductsQuery.parse({ status: 'SOLD' }));

    const listing = client.lastStatement(/FROM products p WHERE .*LIMIT \? OFFSET \?/);
    expect(listing.sql.replace(/\s+/g, ' ')).toContain(
      'WHERE p.seller_id = ? AND p.deleted_at IS NULL AND p.status = ?',
    );
    expect(listing.sql).toContain('ORDER BY p.created_at DESC, p.seq DESC');
    expect(listing.params).toEqual(['seller-1', 'SOLD', 24, 0]);
  });

  it('counts the seller page with the same predicate', async () => {
    const client = readerClient();
    const repository = new MysqlProductRepository(client);

    await repository.listBySeller('seller-1', MyProductsQuery.parse({}));

    const count = client.lastStatement(/SELECT COUNT\(\*\) AS total FROM products/);
    expect(count.sql).toContain('WHERE p.seller_id = ? AND p.deleted_at IS NULL');
    expect(count.params).toEqual(['seller-1']);
  });
});
