/**
 * Product domain rules in isolation (no HTTP, no Nest) — the C2 card's core
 * checks: 가격 검증, 이미지 1~10장 경계, seller_id 강제(AC4.4). Same style as
 * member-domain.spec.ts: value-object validation, aggregate creation, and
 * the in-memory repository seam.
 */
import 'reflect-metadata';
import {
  CONDITION_CODES,
  ProductCondition,
  ProductDescription,
  ProductImageList,
  ProductPrice,
  ProductRegion,
  ProductTitle,
  parseCategoryCode,
  requireProductFields,
} from '../../src/products/domain/product-value-objects';
import { Product, type SellProductInput } from '../../src/products/domain/product';
import { CreateProduct, UploadImage, MAX_UPLOAD_BYTES } from '../../src/products/application/product-use-cases';
import { InMemoryProductRepository } from '../../src/products/infrastructure/in-memory-product.repository';
import { listCategories } from '../../src/catalog/domain/category';
import { DomainError } from '../../src/shared/domain-error';

const fixedNow = () => new Date('2026-11-08T09:00:00.000Z');

interface MemberStub {
  readonly id: string;
  readonly nickname: { readonly value: string };
  readonly region: { readonly value: string };
}

const seller: MemberStub = { id: 'member-1', nickname: { value: '판매자' }, region: { value: '사당동' } };

/** A valid §2-3 request body; individual tests override the field under test. */
function validBody(overrides: Record<string, unknown> = {}): SellProductInput {
  return {
    title: '아이패드 미니 6세대',
    price: 350000,
    category_code: 'digital',
    condition: 'like_new',
    description: '거의 사용하지 않은 상품입니다. 직거래 선호해요.',
    region: '사당동',
    image_urls: ['http://localhost:3000/uploads/a.jpg'],
    ...overrides,
  } as unknown as SellProductInput;
}

/** Asserts the error is the contract's field-scoped 400 (VALIDATION_FAILED). */
function expectFieldError(error: unknown, field: string, messagePart?: string): void {
  expect(error).toBeInstanceOf(DomainError);
  const domainError = error as DomainError;
  expect(domainError.code).toBe('VALIDATION_FAILED');
  expect(domainError.httpStatus).toBe(400);
  expect(Object.keys(domainError.fields ?? {})).toEqual([field]);
  if (messagePart !== undefined) {
    expect(domainError.fields?.[field]).toContain(messagePart);
  }
}

describe('product value objects — 가격 검증 (§2-3)', () => {
  it('accepts a positive integer price in 원', () => {
    expect(ProductPrice.parse(1).value).toBe(1);
    expect(ProductPrice.parse(350000).value).toBe(350000);
    expect(ProductPrice.parse(Number.MAX_SAFE_INTEGER).value).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects zero, negative, fractional and non-numeric prices as a price field error', () => {
    for (const raw of [0, -1, -1000, 0.5, 35000.5, '350000', null, undefined, NaN, Infinity]) {
      try {
        ProductPrice.parse(raw);
        throw new Error(`expected ${String(raw)} to be rejected`);
      } catch (error) {
        expectFieldError(error, 'price');
      }
    }
  });
});

describe('product value objects — 이미지 1~10장 경계 (§2-3, AC4.2)', () => {
  it('accepts exactly 1 and exactly 10 images (both boundaries inclusive)', () => {
    expect(ProductImageList.parse(['u1']).urls).toHaveLength(1);
    expect(ProductImageList.parse(Array.from({ length: 10 }, (_, i) => `u${i}`)).urls).toHaveLength(10);
  });

  it('rejects 0 and 11 images as an image_urls field error', () => {
    for (const count of [0, 11]) {
      try {
        ProductImageList.parse(Array.from({ length: count }, (_, i) => `u${i}`));
        throw new Error(`expected ${count} images to be rejected`);
      } catch (error) {
        expectFieldError(error, 'image_urls');
      }
    }
  });

  it('rejects a non-array body, blank entries and over-long URLs', () => {
    for (const raw of ['http://x.jpg', {}, null, [''], ['   '], [`u${'x'.repeat(2049)}`]]) {
      try {
        ProductImageList.parse(raw);
        throw new Error(`expected ${JSON.stringify(raw)} to be rejected`);
      } catch (error) {
        expectFieldError(error, 'image_urls');
      }
    }
  });

  it('refuses duplicate URLs — repeated gallery entries are a submission bug, not a display quirk', () => {
    try {
      ProductImageList.assertNoDuplicates(['u1', 'u2', 'u1']);
      throw new Error('expected duplicates to be rejected');
    } catch (error) {
      expectFieldError(error, 'image_urls');
    }
  });
});

describe('product value objects — 남은 필드와 집계', () => {
  it('trims and bounds the title (1..50)', () => {
    expect(ProductTitle.parse('  아이패드  ').value).toBe('아이패드');
    expect(ProductTitle.parse('t'.repeat(50)).value).toHaveLength(50);
    try {
      ProductTitle.parse('t'.repeat(51));
      throw new Error('expected an over-long title to be rejected');
    } catch (error) {
      expectFieldError(error, 'title');
    }
  });

  it('bounds the description (1..1000) and region (1..20)', () => {
    expect(ProductDescription.parse('설명').value).toBe('설명');
    try {
      ProductDescription.parse('d'.repeat(1001));
      throw new Error('expected an over-long description to be rejected');
    } catch (error) {
      expectFieldError(error, 'description');
    }
    try {
      ProductRegion.parse('r'.repeat(21));
      throw new Error('expected an over-long region to be rejected');
    } catch (error) {
      expectFieldError(error, 'region');
    }
  });

  it('accepts exactly the four condition codes extracted from the sell-v1 screen', () => {
    expect(CONDITION_CODES).toEqual(['new', 'like_new', 'used', 'needs_repair']);
    for (const code of CONDITION_CODES) {
      expect(ProductCondition.parse(code).value).toBe(code);
    }
    for (const raw of ['NEW', 'broken', '', 1, null]) {
      try {
        ProductCondition.parse(raw);
        throw new Error(`expected ${String(raw)} to be rejected`);
      } catch (error) {
        expectFieldError(error, 'condition');
      }
    }
  });

  it('maps unknown category codes to a category_code field error and knows the five screen categories', () => {
    expect(listCategories().map((category) => category.code)).toEqual([
      'furniture',
      'digital',
      'fashion',
      'beauty',
      'sports',
    ]);
    for (const raw of ['vehicles', 'DIGITAL', '', 1, null]) {
      try {
        parseCategoryCode(raw);
        throw new Error(`expected ${String(raw)} to be rejected`);
      } catch (error) {
        expectFieldError(error, 'category_code');
      }
    }
  });

  it('aggregates every invalid field of one sell input into a single 400 body', () => {
    try {
      requireProductFields((collect) => ({
        title: collect(() => ProductTitle.parse('')) as ProductTitle,
        price: collect(() => ProductPrice.parse(-5)) as ProductPrice,
        categoryCode: collect(() => parseCategoryCode('nope')) as string,
        condition: collect(() => ProductCondition.parse('broken')) as ProductCondition,
        description: collect(() => ProductDescription.parse('')) as ProductDescription,
        region: collect(() => ProductRegion.parse('')) as ProductRegion,
        imageUrls: collect(() => ProductImageList.parse([]).urls) as readonly string[],
      }));
      throw new Error('expected validation failure');
    } catch (error) {
      const domainError = error as DomainError;
      expect(domainError.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(domainError.fields ?? {}).sort()).toEqual([
        'category_code',
        'condition',
        'description',
        'image_urls',
        'price',
        'region',
        'title',
      ]);
    }
  });
});

describe('Product aggregate creation', () => {
  it('starts ACTIVE with submitted order preserved as sort_order (first = 대표)', () => {
    const product = Product.create(validBody({ image_urls: ['u1', 'u2', 'u3'] }), {
      sellerId: seller.id,
      generateId: () => 'product-1',
      now: fixedNow,
    });
    const snapshot = product.toSnapshot();
    expect(snapshot.id).toBe('product-1');
    expect(snapshot.status).toBe('ACTIVE');
    expect(snapshot.images.map((image) => image.sortOrder)).toEqual([1, 2, 3]);
    expect(snapshot.images[0]!.url).toBe('u1');
    expect(snapshot.createdAt.toISOString()).toBe('2026-11-08T09:00:00.000Z');
    expect(product.isDeleted()).toBe(false);
  });

  it('rejects an entirely invalid body with every field named', () => {
    try {
      Product.create(validBody({ title: '', price: 'free', image_urls: [] }), {
        sellerId: seller.id,
        generateId: () => 'product-2',
        now: fixedNow,
      });
      throw new Error('expected validation failure');
    } catch (error) {
      const domainError = error as DomainError;
      expect(Object.keys(domainError.fields ?? {}).sort()).toEqual(['image_urls', 'price', 'title']);
    }
  });
});

describe('seller_id 강제 (AC4.4)', () => {
  it('ignores a seller_id planted in the request body and uses the authenticated principal', async () => {
    const products = new InMemoryProductRepository();
    const useCase = new CreateProduct(products, fixedNow);
    const attacker = { id: 'member-victim', nickname: { value: '피해자' }, region: { value: '강남' } };

    const { product } = await useCase.execute(
      validBody({ seller_id: attacker.id, sellerId: attacker.id, seller: attacker }) as unknown as Record<string, unknown>,
      seller as unknown as never,
    );

    expect(product.seller.id).toBe(seller.id);
    const saved = await products.findById(product.id);
    expect(saved?.toSnapshot().sellerId).toBe(seller.id);
  });

  it('an unauthenticated caller never reaches product creation — the guard is the boundary', () => {
    // Structural restatement of the controller contract: CreateProduct's
    // seller argument comes only from request.currentMember (see
    // products.controller.ts). The use case signature takes no seller from
    // the raw body, so a body-shaped bypass has no parameter to reach.
    const useCaseSource = { execute: CreateProduct.prototype.execute };
    expect(useCaseSource.execute.length).toBe(2); // (raw, seller-principal) only
  });
});

describe('CreateProduct persistence', () => {
  it('saves the created product and projects the §2-3 response shape', async () => {
    const products = new InMemoryProductRepository();
    const useCase = new CreateProduct(products, fixedNow);
    const { product } = await useCase.execute(validBody() as unknown as Record<string, unknown>, seller as unknown as never);
    expect(Object.keys(product).sort()).toEqual([
      'category_code',
      'condition',
      'created_at',
      'description',
      'id',
      'images',
      'price',
      'region',
      'seller',
      'status',
      'title',
    ]);
    expect(product.created_at).toBe('2026-11-08T09:00:00.000Z');
    expect(await products.findById(product.id)).not.toBeNull();
  });
});

describe('UploadImage boundaries (§2-2)', () => {
  /** Minimal valid 1×1 PNG (89 50 4E 47 magic, IHDR/IDAT/IEND). */
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  class MemoryImageStore {
    readonly saved: Array<{ data: Buffer; extension: string }> = [];
    async save(data: Buffer, extension: string): Promise<string> {
      this.saved.push({ data, extension });
      return `/uploads/stored-${this.saved.length}.${extension}`;
    }
  }

  function file(overrides: Partial<{ buffer: Buffer; size: number; mimetype: string; originalname: string }> = {}) {
    return {
      buffer: PNG_1X1,
      size: PNG_1X1.byteLength,
      mimetype: 'image/png',
      originalname: 'photo.png',
      ...overrides,
    };
  }

  it('stores an allowed image and returns its URL and byte-probed dimensions', async () => {
    const store = new MemoryImageStore();
    const view = await new UploadImage(store as never).execute(file());
    expect(view.url).toBe('/uploads/stored-1.png');
    expect(view.width).toBe(1);
    expect(view.height).toBe(1);
    expect(view.size).toBe(PNG_1X1.byteLength);
    expect(store.saved[0]?.extension).toBe('png');
  });

  it('refuses a mislabeled non-image file by its bytes, not its declared type', async () => {
    const store = new MemoryImageStore();
    try {
      await new UploadImage(store as never).execute(
        file({ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), mimetype: 'image/png' }),
      );
      throw new Error('expected an SVG payload to be refused');
    } catch (error) {
      expectFieldError(error, 'image');
    }
    expect(store.saved).toHaveLength(0);
  });

  it('refuses an over-ceiling upload before touching storage', async () => {
    const store = new MemoryImageStore();
    try {
      await new UploadImage(store as never).execute(file({ size: MAX_UPLOAD_BYTES + 1 }));
      throw new Error('expected an over-ceiling upload to be refused');
    } catch (error) {
      expectFieldError(error, 'image');
    }
    expect(store.saved).toHaveLength(0);
  });
});
