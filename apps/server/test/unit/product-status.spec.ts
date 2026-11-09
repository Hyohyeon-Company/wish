/**
 * C7 domain rules in isolation (no HTTP, no Nest) — the card's core checks:
 * the §6 전이표 (legal transitions, terminal SOLD), PATCH status field
 * validation, 권한 (본인만, AC7.1), 동시성 (lost race → 409 CONFLICT), the
 * AC6.2 deletion cleanup inside the deletion transaction, and the
 * §2-4 me/products read side. Same style as product-domain.spec.ts.
 */
import 'reflect-metadata';
import { Product, parseStatusField, invalidTransitionError } from '../../src/products/domain/product';
import type { ProductListingQuery } from '../../src/products/domain/product-listing';
import type { MyProductsQuery } from '../../src/products/domain/my-products-query';
import { InMemoryProductRepository } from '../../src/products/infrastructure/in-memory-product.repository';
import { InMemoryFavoriteRepository } from '../../src/favorites/infrastructure/in-memory-favorite.repository';
import { InMemoryDeletionTransaction } from '../../src/products/infrastructure/in-memory-deletion-transaction';
import { FavoriteRepositoryCleanup } from '../../src/favorites/infrastructure/favorite-repository.cleanup';
import {
  ChangeProductStatus,
  DeleteProduct,
  ListMyProducts,
  type ProductDeletionTransaction,
  type ProductFavoriteCleanup,
  toProductCardView,
} from '../../src/products/application/product-use-cases';
import { Favorite } from '../../src/favorites/domain/favorite';
import { DomainError } from '../../src/shared/domain-error';

const fixedNow = () => new Date('2026-11-10T09:00:00.000Z');
let tick = 0;
const laterNow = () => new Date(1731230400000 + tick++ * 1000);

interface MemberStub {
  readonly id: string;
  readonly nickname: { readonly value: string };
  readonly region: { readonly value: string };
}

const seller: MemberStub = { id: 'seller-1', nickname: { value: '판매자' }, region: { value: '사당동' } };
const other: MemberStub = { id: 'member-9', nickname: { value: '타인' }, region: { value: '사당동' } };
const asMember = (stub: MemberStub) => stub as unknown as Parameters<ChangeProductStatus['execute']>[2];

function makeProduct(sellerId: string): Product {
  return Product.create(
    {
      title: '원목 의자',
      price: 45000,
      category_code: 'furniture',
      condition: 'like_new',
      description: '테스트 상품입니다.',
      region: '사당동',
      image_urls: ['http://localhost:3000/uploads/a.png'],
    },
    { sellerId, generateId: () => `p-${++tick}`, now: fixedNow },
  );
}

function expectError(error: unknown, code: string, status: number): DomainError {
  expect(error).toBeInstanceOf(DomainError);
  const domainError = error as DomainError;
  expect(domainError.code).toBe(code);
  expect(domainError.httpStatus).toBe(status);
  return domainError;
}

describe('§6 상태 전이표 — Product.changeStatus (AC7.2)', () => {
  it('accepts exactly the four legal transitions', () => {
    const cases: Array<['ACTIVE' | 'RESERVED', 'RESERVED' | 'ACTIVE' | 'SOLD']> = [
      ['ACTIVE', 'RESERVED'],
      ['RESERVED', 'ACTIVE'],
      ['ACTIVE', 'SOLD'],
      ['RESERVED', 'SOLD'],
    ];
    for (const [from, to] of cases) {
      // build a product in state `from` by two-step transition where needed
      let product = makeProduct(seller.id);
      if (from === 'RESERVED') product = product.changeStatus('RESERVED', fixedNow());
      const changed = product.changeStatus(to, fixedNow());
      expect(changed.toSnapshot().status).toBe(to);
    }
  });

  it('refuses every 전이표 밖 transition with 400 INVALID_TRANSITION', () => {
    const refused: Array<[string, string]> = [
      ['ACTIVE', 'ACTIVE'],
      ['RESERVED', 'RESERVED'],
      ['SOLD', 'ACTIVE'], // terminal: 되돌림 수요 없음, 직접 API 호출 포함 (B11)
      ['SOLD', 'RESERVED'],
      ['SOLD', 'SOLD'],
    ];
    for (const [from, to] of refused) {
      let product = makeProduct(seller.id);
      if (from === 'RESERVED') product = product.changeStatus('RESERVED', fixedNow());
      if (from === 'SOLD') product = product.changeStatus('RESERVED', fixedNow()).changeStatus('SOLD', fixedNow());
      try {
        product.changeStatus(to as 'ACTIVE', fixedNow());
        throw new Error(`expected ${from}→${to} to be refused`);
      } catch (error) {
        const domainError = expectError(error, 'INVALID_TRANSITION', 400);
        expect(domainError.fields).toBeUndefined();
      }
    }
  });

  it('invalidTransitionError renders user-visible Korean vocabulary', () => {
    expect(invalidTransitionError('ACTIVE', 'SOLD').message).toContain('판매중');
    expect(invalidTransitionError('SOLD', 'ACTIVE').message).toContain('거래완료');
  });
});

describe('PATCH {status} field validation', () => {
  it('accepts the three enum values', () => {
    for (const raw of ['ACTIVE', 'RESERVED', 'SOLD']) {
      expect(parseStatusField(raw)).toBe(raw);
    }
  });

  it('rejects unknown/missing/non-string values as a 400 status field error', () => {
    for (const raw of ['판매중', 'active', '', null, undefined, 42, {}]) {
      try {
        parseStatusField(raw);
        throw new Error(`expected ${String(raw)} to be rejected`);
      } catch (error) {
        const domainError = expectError(error, 'VALIDATION_FAILED', 400);
        expect(Object.keys(domainError.fields ?? {})).toEqual(['status']);
      }
    }
  });
});

describe('ChangeProductStatus — 권한·404·동시성 (AC7.1, B10)', () => {
  async function setup(): Promise<{
    products: InMemoryProductRepository;
    useCase: ChangeProductStatus;
    productId: string;
  }> {
    const products = new InMemoryProductRepository();
    const product = makeProduct(seller.id);
    await products.save(product);
    return {
      products,
      useCase: new ChangeProductStatus(products, fixedNow),
      productId: product.id,
    };
  }

  it('changes the seller’s own product and returns the updated view', async () => {
    const { useCase, productId, products } = await setup();
    const { product } = await useCase.execute(productId, { status: 'RESERVED' }, asMember(seller));
    expect(product.status).toBe('RESERVED');
    const stored = await products.findById(productId);
    expect(stored?.toSnapshot().status).toBe('RESERVED');
    expect(stored?.toSnapshot().version).toBe(1);
  });

  it('refuses a non-owner with 403 FORBIDDEN and leaves the status untouched (AC7.1)', async () => {
    const { useCase, productId, products } = await setup();
    try {
      await useCase.execute(productId, { status: 'SOLD' }, asMember(other));
      throw new Error('expected 403');
    } catch (error) {
      expectError(error, 'FORBIDDEN', 403);
    }
    const stored = await products.findById(productId);
    expect(stored?.toSnapshot().status).toBe('ACTIVE');
  });

  it('answers 404 for an unknown id and for an already-deleted product', async () => {
    const { useCase, products, productId } = await setup();
    try {
      await useCase.execute('no-such-product', { status: 'SOLD' }, asMember(seller));
      throw new Error('expected 404');
    } catch (error) {
      expectError(error, 'NOT_FOUND', 404);
    }
    const product = await products.findById(productId);
    await products.save(product!.markDeleted(fixedNow()));
    try {
      await useCase.execute(productId, { status: 'SOLD' }, asMember(seller));
      throw new Error('expected 404 for deleted product');
    } catch (error) {
      expectError(error, 'NOT_FOUND', 404);
    }
  });

  it('the concurrency loser observes 409 CONFLICT (동시 변경 경합)', async () => {
    const base = new InMemoryProductRepository();
    const product = makeProduct(seller.id);
    await base.save(product);
    // A repository whose FIRST findById is followed by a competing write
    // (another seller-side status change lands), so the caller's own
    // trySave runs against a stale expected version — the exact B10 race.
    class RacingProducts extends InMemoryProductRepository {
      private armed = true;
      constructor(private readonly inner: InMemoryProductRepository) {
        super();
      }
      override async findById(id: string) {
        const found = await this.inner.findById(id);
        if (this.armed && found !== null) {
          this.armed = false;
          const rival = await this.inner.findById(id);
          await this.inner.trySave(rival!.changeStatus('SOLD', laterNow()), rival!.snapshotVersion());
        }
        return found;
      }
      override async trySave(next: Product, expectedVersion: number) {
        return this.inner.trySave(next, expectedVersion);
      }
      override async save(next: Product) {
        return this.inner.save(next);
      }
      override async listBySeller(sellerId: string, query: MyProductsQuery) {
        return this.inner.listBySeller(sellerId, query);
      }
      override async list(query: ProductListingQuery) {
        return this.inner.list(query);
      }
    }
    const racing = new RacingProducts(base);
    const useCase = new ChangeProductStatus(racing, fixedNow);
    try {
      await useCase.execute(product.id, { status: 'RESERVED' }, asMember(seller));
      throw new Error('expected the stale writer to lose with 409');
    } catch (error) {
      expectError(error, 'CONFLICT', 409);
    }
    // The winner's write survived; the loser changed nothing.
    const stored = await base.findById(product.id);
    expect(stored?.toSnapshot().status).toBe('SOLD');
  });

  it('a second status change after a successful one uses the bumped version', async () => {
    const { useCase, products, productId } = await setup();
    await useCase.execute(productId, { status: 'RESERVED' }, asMember(seller));
    const { product } = await useCase.execute(productId, { status: 'ACTIVE' }, asMember(seller));
    expect(product.status).toBe('ACTIVE');
    expect((await products.findById(productId))!.toSnapshot().version).toBe(2);
  });
});

describe('DeleteProduct — AC6.2 찜 정리·권한·404', () => {
  function harness(): {
    products: InMemoryProductRepository;
    favorites: InMemoryFavoriteRepository;
    cleanup: ProductFavoriteCleanup;
    transactions: ProductDeletionTransaction;
    useCase: DeleteProduct;
  } {
    const products = new InMemoryProductRepository();
    const favorites = new InMemoryFavoriteRepository();
    const cleanup = new FavoriteRepositoryCleanup(favorites);
    const transactions = new InMemoryDeletionTransaction();
    return {
      products,
      favorites,
      cleanup,
      transactions,
      useCase: new DeleteProduct(products, cleanup, transactions, fixedNow),
    };
  }

  it('soft-deletes the product and removes every favorite inside the transaction (AC6.2)', async () => {
    const h = harness();
    const product = makeProduct(seller.id);
    await h.products.save(product);
    await h.favorites.save(Favorite.create(other.id, product.id, fixedNow));
    await h.favorites.save(Favorite.create(seller.id, product.id, fixedNow));

    await h.useCase.execute(product.id, asMember(seller));

    const stored = await h.products.findById(product.id);
    expect(stored?.isDeleted()).toBe(true);
    expect(await h.favorites.exists(other.id, product.id)).toBe(false);
    expect(await h.favorites.exists(seller.id, product.id)).toBe(false);
  });

  it('refuses a non-owner with 403 and keeps the product and its favorites', async () => {
    const h = harness();
    const product = makeProduct(seller.id);
    await h.products.save(product);
    await h.favorites.save(Favorite.create(other.id, product.id, fixedNow));
    try {
      await h.useCase.execute(product.id, asMember(other));
      throw new Error('expected 403');
    } catch (error) {
      expectError(error, 'FORBIDDEN', 403);
    }
    expect((await h.products.findById(product.id))?.isDeleted()).toBe(false);
    expect(await h.favorites.exists(other.id, product.id)).toBe(true);
  });

  it('answers 404 for unknown and already-deleted products (삭제는 멱등 아님)', async () => {
    const h = harness();
    const product = makeProduct(seller.id);
    await h.products.save(product);
    await h.useCase.execute(product.id, asMember(seller));
    try {
      await h.useCase.execute(product.id, asMember(seller));
      throw new Error('expected repeat DELETE to 404');
    } catch (error) {
      expectError(error, 'NOT_FOUND', 404);
    }
    try {
      await h.useCase.execute('no-such-product', asMember(seller));
      throw new Error('expected 404');
    } catch (error) {
      expectError(error, 'NOT_FOUND', 404);
    }
  });

  it('a lost deletion race against a status change reports the conflict, not silent overwrite', async () => {
    const h = harness();
    const product = makeProduct(seller.id);
    await h.products.save(product);
    const expectedVersion = product.snapshotVersion();
    // Another writer changes the status first (bumps the stored version).
    const change = new ChangeProductStatus(h.products, fixedNow);
    await change.execute(product.id, { status: 'RESERVED' }, asMember(seller));
    // The stale deletion attempt must NOT delete (version mismatch).
    const lost = await h.products.trySave(product.markDeleted(fixedNow()), expectedVersion);
    expect(lost).toBe(false);
    const stored = await h.products.findById(product.id);
    expect(stored?.isDeleted()).toBe(false);
    expect(stored?.toSnapshot().status).toBe('RESERVED');
  });
});

describe('ListMyProducts (§2-4 GET /api/me/products, B9)', () => {
  it('lists only the seller’s own non-deleted products, newest first', async () => {
    const products = new InMemoryProductRepository();
    const mine1 = makeProduct(seller.id);
    const mine2 = makeProduct(seller.id);
    const others = makeProduct(other.id);
    for (const p of [mine1, mine2, others]) await products.save(p);
    await products.save((await products.findById(mine1.id))!.markDeleted(fixedNow()));

    const useCase = new ListMyProducts(products);
    const page = await useCase.execute({}, asMember(seller));
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.id)).toEqual([mine2.id]);

    const otherPage = await useCase.execute({}, asMember(other));
    expect(otherPage.total).toBe(1);
    expect(otherPage.items[0].id).toBe(others.id);
  });

  it('filters by status and cards carry the status field', async () => {
    const products = new InMemoryProductRepository();
    const active = makeProduct(seller.id);
    const reserved = makeProduct(seller.id).changeStatus('RESERVED', fixedNow());
    await products.save(active);
    await products.save(reserved);
    const useCase = new ListMyProducts(products);

    const soldPage = await useCase.execute({ status: 'SOLD' }, asMember(seller));
    expect(soldPage.total).toBe(0);

    const reservedPage = await useCase.execute({ status: 'RESERVED' }, asMember(seller));
    expect(reservedPage.items.map((item) => item.status)).toEqual(['RESERVED']);

    const all = await useCase.execute({}, asMember(seller));
    expect(all.items.every((item) => typeof item.status === 'string')).toBe(true);
    expect(toProductCardView(reserved).status).toBe('RESERVED');
  });
});
