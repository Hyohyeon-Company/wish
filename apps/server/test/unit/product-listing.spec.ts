/**
 * Product listing rules in isolation (no HTTP, no Nest) — the C3 card's core
 * checks: 최신순 정렬, 0건 빈 목록, 페이징 경계 (§2-3 GET /api/products),
 * plus the combining filters and the 400 field boundaries of the query.
 */
import 'reflect-metadata';
import { Product, type SellProductInput } from '../../src/products/domain/product';
import { ProductListingQuery } from '../../src/products/domain/product-listing';
import { ListProducts } from '../../src/products/application/product-use-cases';
import { InMemoryProductRepository } from '../../src/products/infrastructure/in-memory-product.repository';
import { DomainError } from '../../src/shared/domain-error';

const SELLER = { id: 'member-1', nickname: { value: '판매자' }, region: { value: '사당동' } };

let counter = 0;

/** Creates and saves one product with a controlled creation clock. */
async function seed(
  products: InMemoryProductRepository,
  overrides: {
    title?: string;
    price?: number;
    categoryCode?: string;
    status?: 'ACTIVE' | 'RESERVED' | 'SOLD';
    region?: string;
    createdAt?: Date;
    images?: string[];
  } = {},
): Promise<Product> {
  counter += 1;
  const body: SellProductInput = {
    title: overrides.title ?? `상품 ${counter}`,
    price: overrides.price ?? 10000,
    category_code: overrides.categoryCode ?? 'digital',
    condition: 'like_new',
    description: '설명',
    region: overrides.region ?? '사당동',
    image_urls: overrides.images ?? [`http://localhost:3000/uploads/${counter}.jpg`],
  } as unknown as SellProductInput;
  const createdAt = overrides.createdAt ?? new Date('2026-11-09T09:00:00.000Z');
  const product = Product.create(body, {
    sellerId: SELLER.id,
    generateId: () => `product-${counter}`,
    now: () => createdAt,
  });
  if (overrides.status !== undefined && overrides.status !== 'ACTIVE') {
    // Only the C3-visible states are seeded here; transitions themselves are
    // C7's rules, so the snapshot round-trip stands in for them.
    const snapshot = {
      ...product.toSnapshot(),
      status: overrides.status,
    };
    const rehydrated = Product.fromSnapshot(snapshot);
    await products.save(rehydrated);
    return rehydrated;
  }
  await products.save(product);
  return product;
}

function expectFieldError(error: unknown, field: string): void {
  expect(error).toBeInstanceOf(DomainError);
  const domainError = error as DomainError;
  expect(domainError.code).toBe('VALIDATION_FAILED');
  expect(domainError.httpStatus).toBe(400);
  expect(Object.keys(domainError.fields ?? {})).toEqual([field]);
}

describe('최신순 정렬 (sort=latest, AC1.1·AC4.3)', () => {
  it('returns products newest-created first regardless of insertion order', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, { title: '오래된 상품', createdAt: new Date('2026-11-01T09:00:00.000Z') });
    await seed(products, { title: '중간 상품', createdAt: new Date('2026-11-05T09:00:00.000Z') });
    await seed(products, { title: '가장 최근 상품', createdAt: new Date('2026-11-09T09:00:00.000Z') });

    const { items } = await new ListProducts(products).execute({});
    expect(items.map((item) => item.title)).toEqual([
      '가장 최근 상품',
      '중간 상품',
      '오래된 상품',
    ]);
  });

  it('defaults to latest when no sort is given and rejects unknown sort values', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, { title: '오래된', createdAt: new Date('2026-11-01T09:00:00.000Z') });
    await seed(products, { title: '최신', createdAt: new Date('2026-11-02T09:00:00.000Z') });

    expect((await new ListProducts(products).execute({})).items[0]?.title).toBe('최신');
    expect((await new ListProducts(products).execute({ sort: '' })).items[0]?.title).toBe('최신');
    for (const raw of ['oldest', 'LATEST', 'price', 1, null]) {
      try {
        ProductListingQuery.parse({ sort: raw });
        throw new Error(`expected ${String(raw)} to be rejected`);
      } catch (error) {
        expectFieldError(error, 'sort');
      }
    }
  });

  it('keeps a deterministic newest-first order for identical creation timestamps', async () => {
    const products = new InMemoryProductRepository();
    const sameMoment = new Date('2026-11-09T09:00:00.000Z');
    await seed(products, { title: '먼저 등록', createdAt: sameMoment });
    await seed(products, { title: '나중에 등록', createdAt: sameMoment });

    const { items } = await new ListProducts(products).execute({});
    expect(items.map((item) => item.title)).toEqual(['나중에 등록', '먼저 등록']);
  });

  it('orders price_asc/price_desc by price, newest-first as the tie-break', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, { title: 'A', price: 30000, createdAt: new Date('2026-11-03T09:00:00.000Z') });
    await seed(products, { title: 'B', price: 10000, createdAt: new Date('2026-11-04T09:00:00.000Z') });
    await seed(products, { title: 'C', price: 30000, createdAt: new Date('2026-11-05T09:00:00.000Z') });

    const useCase = new ListProducts(products);
    expect((await useCase.execute({ sort: 'price_asc' })).items.map((i) => i.title)).toEqual([
      'B',
      'C',
      'A',
    ]);
    expect((await useCase.execute({ sort: 'price_desc' })).items.map((i) => i.title)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });
});

describe('0건 빈 목록 (AC1.2)', () => {
  it('answers an empty repository with 200-shape {items: [], total: 0}', async () => {
    const page = await new ListProducts(new InMemoryProductRepository()).execute({});
    expect(page).toEqual({ items: [], total: 0, page: 1, limit: 24 });
  });

  it('answers a filtered-out (but non-empty) repository the same way', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, { categoryCode: 'digital' });
    const page = await new ListProducts(products).execute({ category: 'fashion' });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe('페이징 경계 (§2-0: page 1 시작, limit 기본 24·최대 50)', () => {
  it('returns the default limit of 24 with the true total on page 1', async () => {
    const products = new InMemoryProductRepository();
    for (let index = 0; index < 25; index += 1) {
      await seed(products, {
        title: `상품 ${String(index).padStart(2, '0')}`,
        createdAt: new Date(Date.UTC(2026, 10, 9, 9, 0, index * 1000)),
      });
    }
    const page = await new ListProducts(products).execute({});
    expect(page.items).toHaveLength(24);
    expect(page.total).toBe(25);
    expect(page.page).toBe(1);
    expect(page.limit).toBe(24);
    // Newest first: the last-seeded (latest second) product leads the page.
    expect(page.items[0]?.title).toBe('상품 24');
  });

  it('serves the exact remainder page and an empty page beyond the total', async () => {
    const products = new InMemoryProductRepository();
    for (let index = 0; index < 25; index += 1) {
      await seed(products, {
        title: `상품 ${String(index).padStart(2, '0')}`,
        createdAt: new Date(Date.UTC(2026, 10, 9, 9, 0, index * 1000)),
      });
    }
    const useCase = new ListProducts(products);
    const second = await useCase.execute({ page: '2' });
    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(25);
    expect(second.page).toBe(2);
    expect(second.items[0]?.title).toBe('상품 00');

    const beyond = await useCase.execute({ page: '3' });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(25);
  });

  it('accepts the limit maximum of 50 and serves fewer items than the limit', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, {});
    await seed(products, {});
    const page = await new ListProducts(products).execute({ limit: '50' });
    expect(page.items).toHaveLength(2);
    expect(page.limit).toBe(50);
  });

  it('rejects out-of-bound page/limit values as field errors, not silent clamps', () => {
    for (const raw of ['0', '-1', '1.5', 'abc']) {
      try {
        ProductListingQuery.parse({ page: raw });
        throw new Error(`expected page=${String(raw)} to be rejected`);
      } catch (error) {
        expectFieldError(error, 'page');
      }
      try {
        ProductListingQuery.parse({ limit: raw });
        throw new Error(`expected limit=${String(raw)} to be rejected`);
      } catch (error) {
        expectFieldError(error, 'limit');
      }
    }
    expect(ProductListingQuery.parse({ page: '1' }).page).toBe(1);
    try {
      ProductListingQuery.parse({ limit: '51' });
      throw new Error('expected limit=51 to be rejected');
    } catch (error) {
      expectFieldError(error, 'limit');
    }
  });
});

describe('삭제 상품 제외 (§6 deleted_at → 목록 제외)', () => {
  it('excludes soft-deleted products from items and total', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, { title: '남은 상품' });
    const doomed = await seed(products, { title: '삭제된 상품' });
    // Soft-delete through the persistence snapshot (the deletion use case
    // itself is C7's rule; the listing must already respect the state).
    await products.save(
      Product.fromSnapshot({ ...doomed.toSnapshot(), deletedAt: new Date('2026-11-09T10:00:00.000Z') }),
    );

    const page = await new ListProducts(products).execute({});
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.title)).toEqual(['남은 상품']);
  });
});

describe('필터 조합 (§2-3 query, AC2.2 계약)', () => {
  it('matches q as a case-insensitive partial title match', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, { title: '아이패드 에어 5세대' });
    await seed(products, { title: '원목 식탁 4인용' });

    const useCase = new ListProducts(products);
    expect((await useCase.execute({ q: '아이패드' })).total).toBe(1);
    expect((await useCase.execute({ q: '아이패드' })).items[0]?.title).toBe('아이패드 에어 5세대');
    expect((await useCase.execute({ q: '식탁' })).total).toBe(1);
    expect((await useCase.execute({ q: '' })).total).toBe(2); // empty q = no filter
  });

  it('combines category, status, price range and region filters', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, { title: '매칭', price: 50000, categoryCode: 'furniture', status: 'RESERVED', region: '상도동' });
    await seed(products, { title: '카테고리 다름', price: 50000, categoryCode: 'digital', status: 'RESERVED', region: '상도동' });
    await seed(products, { title: '상태 다름', price: 50000, categoryCode: 'furniture', status: 'ACTIVE', region: '상도동' });
    await seed(products, { title: '가격 낮음', price: 49999, categoryCode: 'furniture', status: 'RESERVED', region: '상도동' });
    await seed(products, { title: '지역 다름', price: 50000, categoryCode: 'furniture', status: 'RESERVED', region: '사당동' });

    const page = await new ListProducts(products).execute({
      category: 'furniture',
      status: 'RESERVED',
      min_price: '50000',
      max_price: '50000',
      region: '상도동',
    });
    expect(page.total).toBe(1);
    expect(page.items[0]?.title).toBe('매칭');
  });

  it('treats min_price as an inclusive lower bound and max_price as inclusive upper', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, { title: '하한', price: 1000 });
    await seed(products, { title: '상한', price: 9000 });
    await seed(products, { title: '중간', price: 5000 });
    const page = await new ListProducts(products).execute({ min_price: '1000', max_price: '9000' });
    expect(page.total).toBe(3);
  });

  it('rejects unknown category/status values and a reversed price range', () => {
    for (const [raw, field] of [
      [{ category: 'vehicles' }, 'category'],
      [{ category: 'DIGITAL' }, 'category'],
      [{ status: 'PAUSED' }, 'status'],
      [{ min_price: '만원' }, 'min_price'],
      [{ max_price: '-5' }, 'max_price'],
      [{ min_price: '9000', max_price: '1000' }, 'min_price'],
    ] as Array<[Record<string, unknown>, string]>) {
      try {
        ProductListingQuery.parse(raw);
        throw new Error(`expected ${JSON.stringify(raw)} to be rejected`);
      } catch (error) {
        expectFieldError(error, field);
      }
    }
  });
});

describe('응답 프로젝션 (§2-4 ProductCard)', () => {
  it('projects the exact ProductCard shape with the sort_order-min thumbnail', async () => {
    const products = new InMemoryProductRepository();
    await seed(products, {
      title: '아이패드 미니',
      price: 350000,
      images: ['http://localhost:3000/uploads/first.jpg', 'http://localhost:3000/uploads/second.jpg'],
      createdAt: new Date('2026-11-09T09:00:00.000Z'),
    });

    const { items } = await new ListProducts(products).execute({});
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      'condition',
      'created_at',
      'id',
      'price',
      'region',
      'status',
      'thumbnail_url',
      'title',
    ]);
    expect(items[0]?.thumbnail_url).toBe('http://localhost:3000/uploads/first.jpg');
    expect(items[0]?.price).toBe(350000);
    expect(items[0]?.status).toBe('ACTIVE');
    expect(items[0]?.created_at).toBe('2026-11-09T09:00:00.000Z');
  });

  it('returns thumbnail_url null when a product somehow has no image rows', async () => {
    const products = new InMemoryProductRepository();
    const product = await seed(products, {});
    // Rehydrate without images: the persistence seam never loses the 1..10
    // invariant for new writes, but the card projection must not invent a URL.
    const snapshot = { ...product.toSnapshot(), images: [] };
    await products.save(Product.fromSnapshot(snapshot));

    const { items } = await new ListProducts(products).execute({});
    expect(items[0]?.thumbnail_url).toBeNull();
  });
});
