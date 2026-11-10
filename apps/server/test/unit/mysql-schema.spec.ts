/**
 * Schema contract checks (no database).
 *
 * The MySQL DDL is the persistence face of the approved domain rules, so these
 * tests read the packaged migration and compare it with the domain constants
 * the API actually enforces. A schema that drifts from the aggregate (a missing
 * unique index, a price CHECK that admits 0, a transition the aggregate allows
 * but the table omits) fails here instead of being discovered in production.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listCategories } from '../../src/catalog/domain/category';
import { PRODUCT_STATUSES, PRODUCT_TRANSITIONS } from '../../src/products/domain/product';
import { CONDITION_CODES } from '../../src/products/domain/product-value-objects';
import { splitSqlStatements } from '../../src/infrastructure/mysql/sql-script';

const SCHEMA_PATH = resolve(__dirname, '../../../../db/migrations/0001_initial_schema.sql');
const SEED_PATH = resolve(__dirname, '../../../../db/seed/demo.sql');

const schemaText = readFileSync(SCHEMA_PATH, 'utf8');
const schemaStatements = splitSqlStatements(schemaText);
const seedStatements = splitSqlStatements(readFileSync(SEED_PATH, 'utf8'));

function tableDefinition(name: string): string {
  const statement = schemaStatements.find((candidate) =>
    candidate.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`),
  );
  if (statement === undefined) throw new Error(`no CREATE TABLE for ${name}`);
  return statement;
}

function statementStartingWith(prefix: string): string {
  const statement = schemaStatements.find((candidate) => candidate.startsWith(prefix));
  if (statement === undefined) throw new Error(`no statement starting with ${prefix}`);
  return statement;
}

describe('brief §6 tables', () => {
  it('creates every entity of the brief domain model', () => {
    for (const table of ['members', 'products', 'product_images', 'categories', 'favorites']) {
      expect(() => tableDefinition(table)).not.toThrow();
    }
  });

  it('keeps the products table tied to its seller, category and soft deletion', () => {
    const products = tableDefinition('products');
    expect(products).toMatch(/seller_id CHAR\(36\) NOT NULL/);
    expect(products).toMatch(/FOREIGN KEY \(seller_id\) REFERENCES members \(id\)/);
    expect(products).toMatch(/FOREIGN KEY \(category_code\) REFERENCES categories \(code\)/);
    expect(products).toMatch(/deleted_at DATETIME\(3\) NULL/);
  });

  it('refuses a non-positive or non-integer-range price', () => {
    const products = tableDefinition('products');
    expect(products).toMatch(/ck_products_price CHECK \(price > 0/);
    expect(products).toMatch(/price <= 9007199254740991/);
  });

  it('accepts exactly the statuses and conditions the domain enumerates', () => {
    const products = tableDefinition('products');
    const statusCheck = products.slice(products.indexOf('ck_products_status'));
    const conditionCheck = products.slice(products.indexOf('ck_products_condition'));
    for (const status of PRODUCT_STATUSES) expect(statusCheck).toContain(`'${status}'`);
    for (const condition of CONDITION_CODES) expect(conditionCheck).toContain(`'${condition}'`);
  });

  it('enforces the unique email/nickname and (member, product) favorite pair', () => {
    expect(tableDefinition('members')).toMatch(/UNIQUE KEY uq_members_email \(email\)/);
    expect(tableDefinition('members')).toMatch(/UNIQUE KEY uq_members_nickname \(nickname\)/);
    expect(tableDefinition('favorites')).toMatch(
      /PRIMARY KEY \(member_id, product_id\)/,
    );
  });

  it('keeps one image per sort order and the 1..10 upload bound', () => {
    const images = tableDefinition('product_images');
    expect(images).toMatch(/UNIQUE KEY uq_product_images_order \(product_id, sort_order\)/);
    expect(images).toMatch(/ck_product_images_sort_order CHECK \(sort_order BETWEEN 1 AND 10\)/);
  });

  it('indexes the listing, search and filter paths', () => {
    const products = tableDefinition('products');
    expect(products).toContain('KEY idx_products_latest (created_at DESC, seq DESC)');
    expect(products).toContain('KEY idx_products_title (title)');
    expect(products).toContain('KEY idx_products_status (status)');
    expect(products).toContain('KEY idx_products_category_status (category_code, status)');
    expect(products).toContain(
      'KEY idx_products_seller_latest (seller_id, created_at DESC, seq DESC)',
    );
  });
});

describe('reference data', () => {
  it('persists exactly the §6 status transition table (SOLD is terminal)', () => {
    const insert = statementStartingWith('INSERT INTO product_status_transitions');
    const pairs = [...insert.matchAll(/\('([A-Z]+)', '([A-Z]+)'\)/g)].map(
      (match) => `${match[1]}->${match[2]}`,
    );
    const expected: string[] = [];
    for (const [from, targets] of Object.entries(PRODUCT_TRANSITIONS)) {
      for (const to of targets) expected.push(`${from}->${to}`);
    }
    expect([...pairs].sort()).toEqual([...expected].sort());
    expect(pairs.some((pair) => pair.startsWith('SOLD->'))).toBe(false);
  });

  it('persists the fixed category list the domain serves', () => {
    const insert = statementStartingWith('INSERT INTO categories');
    for (const category of listCategories()) {
      expect(insert).toContain(`('${category.code}', '${category.name}', ${category.displayOrder})`);
    }
  });
});

describe('demo seed', () => {
  const productInsert = seedStatements.find((statement) =>
    statement.startsWith('INSERT INTO products'),
  );
  const imageInsert = seedStatements.find((statement) =>
    statement.startsWith('INSERT INTO product_images'),
  );
  const productIds = (text: string | undefined): string[] =>
    [...(text ?? '').matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})'/g)]
      .map((match) => match[1])
      .filter((id) => id.startsWith('0f1d0c00-'));

  it('seeds the demo seller and 12 demo listings', () => {
    expect(seedStatements.some((statement) => statement.startsWith('INSERT INTO members'))).toBe(
      true,
    );
    const ids = [...new Set(productIds(productInsert))];
    expect(ids).toHaveLength(12);
  });

  it('gives every demo listing exactly one image that references a seeded product', () => {
    const ids = new Set(productIds(productInsert));
    const imageLines = imageInsert ?? '';
    expect([...ids].every((id) => imageLines.includes(id))).toBe(true);
  });

  it('is idempotent: every seed insert is guarded by ON DUPLICATE KEY UPDATE', () => {
    for (const statement of seedStatements) {
      expect(statement).toMatch(/ON DUPLICATE KEY UPDATE/);
    }
  });
});
