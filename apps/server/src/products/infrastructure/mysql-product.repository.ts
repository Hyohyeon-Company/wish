/**
 * MySQL adapter of the Product aggregate's repository port.
 *
 * The in-memory adapter owns filtering/ordering in JavaScript; here the
 * database does it, so this file is where the §2-3 listing semantics become
 * SQL. The legality of a query value still belongs to
 * `ProductListingQuery`/`MyProductsQuery`; this adapter only translates an
 * already-validated value object.
 *
 * Recorded decisions:
 * - every read filters `deleted_at IS NULL` (§6 소프트 삭제 → 목록·검색·상세 제외);
 * - `latest` is `created_at DESC, seq DESC`, where `seq` is the table's
 *   auto-increment tie-break. The in-memory adapter uses its insertion order
 *   for the same purpose, so both adapters keep "최신순" stable inside one
 *   millisecond;
 * - the keyword filter is `title LIKE ?` with `%`, `_` and `\` escaped in the
 *   parameter, so a search for "50%" means the literal text, not a wildcard
 *   (the in-memory adapter's `includes` is literal too). Case-insensitivity
 *   comes from the column collation (`utf8mb4_0900_ai_ci`), which matches
 *   AC2.1's 대소문자 무시 rule;
 * - `trySave` is the §2-5-5 optimistic-concurrency write: it succeeds only if
 *   the stored row still carries `expectedVersion`, and a lost race answers
 *   false (the caller renders the contract's 409) instead of overwriting;
 * - a product insert and its images commit together, so no listing can exist
 *   without the image rows the detail contract reads.
 */
import {
  Product,
  PRODUCT_STATUSES,
  type ProductPage,
  type ProductRepository,
  type ProductSnapshot,
  type ProductStatus,
} from '../domain/product';
import type { ProductImageSnapshot } from '../domain/product';
import type { ProductListingQuery } from '../domain/product-listing';
import type { MyProductsQuery } from '../domain/my-products-query';
import type { SqlClient, SqlParameter } from '../../infrastructure/mysql/sql-client';
import { toDate, toNullableDate, toNumber } from '../../infrastructure/mysql/mysql-support';

const PRODUCT_COLUMNS =
  'p.id, p.seller_id, p.title, p.description, p.price, p.category_code, ' +
  'p.condition_code, p.region, p.status, p.created_at, p.updated_at, p.deleted_at, p.version';

const INSERT_PRODUCT = `INSERT INTO products
  (id, seller_id, title, description, price, category_code, condition_code, region,
   status, created_at, updated_at, deleted_at, version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** §2-5-5 conditional write; `version` is the stored optimistic token. */
const UPDATE_PRODUCT_STATE = `UPDATE products
  SET status = ?, updated_at = ?, deleted_at = ?, version = version + 1
  WHERE id = ? AND version = ?`;

const SELECT_IMAGES = `SELECT product_id, url, sort_order FROM product_images
  WHERE product_id IN (%LIST%) ORDER BY product_id ASC, sort_order ASC`;

interface ProductRow {
  readonly id: string;
  readonly seller_id: string;
  readonly title: string;
  readonly description: string;
  readonly price: unknown;
  readonly category_code: string;
  readonly condition_code: string;
  readonly region: string;
  readonly status: string;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly deleted_at: unknown;
  readonly version: unknown;
}

interface ProductImageRow {
  readonly product_id: string;
  readonly url: string;
  readonly sort_order: unknown;
}

export function escapeLikePattern(keyword: string): string {
  // MySQL's default LIKE escape character is the backslash.
  return keyword.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** A single optional filter: SQL fragment plus its bound parameter. */
interface SqlFilter {
  readonly sql: string;
  readonly value: SqlParameter;
}

/** SQL fragment (leading `WHERE`) + bound parameters for the public listing. */
export function listingConditions(query: ProductListingQuery): {
  readonly sql: string;
  readonly params: readonly SqlParameter[];
} {
  return conditionsFor(
    [
      query.keyword === null
        ? null
        : { sql: 'p.title LIKE ?', value: `%${escapeLikePattern(query.keyword)}%` },
      query.categoryCode === null ? null : { sql: 'p.category_code = ?', value: query.categoryCode },
      query.minPrice === null ? null : { sql: 'p.price >= ?', value: query.minPrice },
      query.maxPrice === null ? null : { sql: 'p.price <= ?', value: query.maxPrice },
      query.status === null ? null : { sql: 'p.status = ?', value: query.status },
      query.region === null ? null : { sql: 'p.region = ?', value: query.region },
    ],
    'p.deleted_at IS NULL',
  );
}

export function listingOrder(sort: ProductListingQuery['sort']): string {
  switch (sort) {
    case 'latest':
      return 'p.created_at DESC, p.seq DESC';
    case 'price_asc':
      return 'p.price ASC, p.created_at DESC, p.seq DESC';
    case 'price_desc':
      return 'p.price DESC, p.created_at DESC, p.seq DESC';
  }
}

function conditionsFor(
  filters: ReadonlyArray<SqlFilter | null>,
  base: string,
): { readonly sql: string; readonly params: readonly SqlParameter[] } {
  const clauses: string[] = [base];
  const params: SqlParameter[] = [];
  for (const filter of filters) {
    if (filter === null) continue;
    clauses.push(filter.sql);
    params.push(filter.value);
  }
  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

function toProductStatus(value: unknown): ProductStatus {
  if (typeof value === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(value)) {
    return value as ProductStatus;
  }
  throw new Error(`products.status carried an unknown value: ${String(value)}`);
}

export class MysqlProductRepository implements ProductRepository {
  constructor(private readonly client: SqlClient) {}

  async save(product: Product): Promise<void> {
    const snapshot = product.toSnapshot();
    await this.client.transaction(async () => {
      await this.client.execute(INSERT_PRODUCT, [
        snapshot.id,
        snapshot.sellerId,
        snapshot.title,
        snapshot.description,
        snapshot.price,
        snapshot.categoryCode,
        snapshot.condition,
        snapshot.region,
        snapshot.status,
        snapshot.createdAt,
        snapshot.updatedAt,
        snapshot.deletedAt,
        snapshot.version,
      ]);
      await this.insertImages(snapshot.id, snapshot.images);
    });
  }

  async findById(id: string): Promise<Product | null> {
    const rows = await this.client.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = ? LIMIT 1`,
      [id],
    );
    if (rows.length === 0) return null;
    const images = await this.imagesFor([id]);
    return Product.fromSnapshot(toSnapshot(rows[0], images.get(id) ?? []));
  }

  async list(query: ProductListingQuery): Promise<ProductPage> {
    const { sql: where, params } = listingConditions(query);
    const rows = await this.client.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products p ${where} ORDER BY ${listingOrder(query.sort)} LIMIT ? OFFSET ?`,
      [...params, query.limit, query.offset],
    );
    return this.toPage(rows, await this.count(where, params));
  }

  async listBySeller(sellerId: string, query: MyProductsQuery): Promise<ProductPage> {
    const { sql: where, params } = conditionsFor(
      [query.status === null ? null : { sql: 'p.status = ?', value: query.status }],
      'p.seller_id = ? AND p.deleted_at IS NULL',
    );
    const bound = [sellerId, ...params];
    const rows = await this.client.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products p ${where} ORDER BY p.created_at DESC, p.seq DESC LIMIT ? OFFSET ?`,
      [...bound, query.limit, query.offset],
    );
    return this.toPage(rows, await this.count(where, bound));
  }

  async trySave(next: Product, expectedVersion: number): Promise<boolean> {
    const snapshot = next.toSnapshot();
    const affected = await this.client.execute(UPDATE_PRODUCT_STATE, [
      snapshot.status,
      snapshot.updatedAt,
      snapshot.deletedAt,
      snapshot.id,
      expectedVersion,
    ]);
    return affected === 1;
  }

  private async count(where: string, params: readonly SqlParameter[]): Promise<number> {
    const rows = await this.client.query<{ total: unknown }>(
      `SELECT COUNT(*) AS total FROM products p ${where}`,
      params,
    );
    if (rows.length === 0) throw new Error('products count returned no row');
    return toNumber(rows[0].total, 'products.total');
  }

  private async toPage(rows: readonly ProductRow[], total: number): Promise<ProductPage> {
    if (rows.length === 0) return { items: [], total };
    const images = await this.imagesFor(rows.map((row) => row.id));
    return {
      items: rows.map((row) => Product.fromSnapshot(toSnapshot(row, images.get(row.id) ?? []))),
      total,
    };
  }

  private async insertImages(
    productId: string,
    images: readonly ProductImageSnapshot[],
  ): Promise<void> {
    if (images.length === 0) return;
    const rows = images.map(() => '(?, ?, ?)').join(', ');
    const params: SqlParameter[] = [];
    for (const image of images) params.push(productId, image.url, image.sortOrder);
    await this.client.execute(
      `INSERT INTO product_images (product_id, url, sort_order) VALUES ${rows}`,
      params,
    );
  }

  private async imagesFor(
    productIds: readonly string[],
  ): Promise<Map<string, ProductImageSnapshot[]>> {
    const byProduct = new Map<string, ProductImageSnapshot[]>();
    if (productIds.length === 0) return byProduct;
    const list = productIds.map(() => '?').join(', ');
    const rows = await this.client.query<ProductImageRow>(
      SELECT_IMAGES.replace('%LIST%', list),
      [...productIds],
    );
    for (const row of rows) {
      const images = byProduct.get(row.product_id) ?? [];
      images.push({
        url: row.url,
        sortOrder: toNumber(row.sort_order, 'product_images.sort_order'),
      });
      byProduct.set(row.product_id, images);
    }
    return byProduct;
  }
}

function toSnapshot(
  row: ProductRow,
  images: readonly ProductImageSnapshot[],
): ProductSnapshot {
  return {
    id: row.id,
    sellerId: row.seller_id,
    title: row.title,
    description: row.description,
    price: toNumber(row.price, 'products.price'),
    categoryCode: row.category_code,
    condition: row.condition_code,
    region: row.region,
    status: toProductStatus(row.status),
    createdAt: toDate(row.created_at, 'products.created_at'),
    updatedAt: toDate(row.updated_at, 'products.updated_at'),
    deletedAt: toNullableDate(row.deleted_at, 'products.deleted_at'),
    images,
    version: toNumber(row.version, 'products.version'),
  };
}
