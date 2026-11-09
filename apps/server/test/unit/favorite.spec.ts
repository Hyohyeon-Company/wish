/**
 * Favorite domain rules in isolation (no HTTP, no Nest) — the C6 card's core
 * checks (§2-4 찜 계약): the (member_id, product_id) unique invariant, the
 * idempotent favorite/unfavorite toggle, the 비로그인 401 refusal at the
 * guard boundary, the 404 for favoriting a missing/deleted product, the
 * 최신 찜순 listing, and the AC6.2 deletion cleanup at the repository level
 * (the DELETE /api/products endpoint itself is card C7's deliverable).
 */
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Member, type PasswordHasher } from '../../src/members/domain/member';
import { Product } from '../../src/products/domain/product';
import { Favorite } from '../../src/favorites/domain/favorite';
import { FavoriteListQuery, favoriteProductField } from '../../src/favorites/domain/favorite-list-query';
import {
  FavoriteProduct,
  ListFavorites,
  UnfavoriteProduct,
} from '../../src/favorites/application/favorite-use-cases';
import { InMemoryFavoriteRepository } from '../../src/favorites/infrastructure/in-memory-favorite.repository';
import { FavoriteRepositoryLookup } from '../../src/favorites/infrastructure/favorite-repository.lookup';
import { InMemoryProductRepository } from '../../src/products/infrastructure/in-memory-product.repository';
import { InMemoryMemberRepository } from '../../src/infrastructure/in-memory-member.repository';
import { SessionTokenService } from '../../src/infrastructure/session-token.service';
import { AuthenticateMember } from '../../src/members/application/auth-use-cases';
import { CurrentMemberGuard } from '../../src/api/current-member.guard';
import { DomainError } from '../../src/shared/domain-error';

const stubHasher = {
  hash: async (plain: string) => `hash(${plain})`,
  verify: async () => true,
} as unknown as PasswordHasher;

const TICK = () => new Date('2026-11-10T09:00:00.000Z');

async function seedMember(
  members: InMemoryMemberRepository,
  id: string,
): Promise<Member> {
  const member = await Member.signUp(
    {
      email: `${id}@example.com`,
      password: 'Str0ng-Pass!',
      nickname: `닉네임-${id}`,
      region: '사당동',
    },
    { hasher: stubHasher, generateId: () => id, now: TICK },
  );
  await members.save(member);
  return member;
}

const SELL_FORM = {
  title: '원목 식탁 4인용',
  price: 120000,
  category_code: 'furniture',
  condition: 'like_new',
  description: '이사 가면서 판매합니다.',
  region: '사당동',
  image_urls: ['http://localhost:3000/uploads/table-1.png'],
};

/** Seeds one product with the given id (and optional deletion) into the repo. */
async function seedProduct(
  products: InMemoryProductRepository,
  id: string,
  sellerId = 'seller-1',
  deletedAt: Date | null = null,
): Promise<Product> {
  const product = Product.create(SELL_FORM, {
    sellerId,
    generateId: () => id,
    now: TICK,
  });
  const stored =
    deletedAt === null
      ? product
      : Product.fromSnapshot({ ...product.toSnapshot(), deletedAt });
  await products.save(stored);
  return stored;
}

interface Harness {
  products: InMemoryProductRepository;
  members: InMemoryMemberRepository;
  favorites: InMemoryFavoriteRepository;
  favoriteProduct: FavoriteProduct;
  unfavoriteProduct: UnfavoriteProduct;
  listFavorites: ListFavorites;
}

function harness(): Harness {
  const products = new InMemoryProductRepository();
  const members = new InMemoryMemberRepository();
  const favorites = new InMemoryFavoriteRepository();
  return {
    products,
    members,
    favorites,
    favoriteProduct: new FavoriteProduct(products, favorites, TICK),
    unfavoriteProduct: new UnfavoriteProduct(favorites),
    listFavorites: new ListFavorites(favorites, products),
  };
}

describe('Favorite aggregate + repository (§2-4 invariants)', () => {
  it('keeps (member_id, product_id) unique — a duplicate save is refused', async () => {
    const { favorites } = harness();
    const first = Favorite.create('m-1', 'p-1', TICK);
    const second = Favorite.create('m-1', 'p-1', TICK);
    await favorites.save(first);
    await expect(favorites.save(second)).rejects.toThrow(/unique invariant/);
    expect(await favorites.exists('m-1', 'p-1')).toBe(true);
  });

  it('allows the same product favorited by different members', async () => {
    const { favorites } = harness();
    await favorites.save(Favorite.create('m-1', 'p-1', TICK));
    await favorites.save(Favorite.create('m-2', 'p-1', TICK));
    expect(await favorites.exists('m-1', 'p-1')).toBe(true);
    expect(await favorites.exists('m-2', 'p-1')).toBe(true);
    expect(await favorites.exists('m-3', 'p-1')).toBe(false);
  });

  it('orders a member page 최신 찜순 with a stable same-millisecond tie-break', async () => {
    const { favorites } = harness();
    // All three favorites share the same favoritedAt instant — the adapter's
    // insertion sequence must keep them newest-insert-first.
    const now = () => new Date('2026-11-10T09:00:00.000Z');
    await favorites.save(Favorite.create('m-1', 'p-1', now));
    await favorites.save(Favorite.create('m-1', 'p-2', now));
    await favorites.save(Favorite.create('m-1', 'p-3', now));
    await favorites.save(Favorite.create('m-2', 'p-4', now)); // another member

    const page = await favorites.pageFor('m-1', 0, 24);
    expect(page.total).toBe(3);
    expect(page.entries.map((entry) => entry.productId)).toEqual(['p-3', 'p-2', 'p-1']);
  });
});

describe('FavoriteProduct use case (§2-4 POST)', () => {
  it('creates a new favorite — the 201 신규 path', async () => {
    const h = harness();
    await seedProduct(h.products, 'p-1');
    const member = await seedMember(h.members, 'm-1');

    const result = await h.favoriteProduct.execute('p-1', member);

    expect(result).toEqual({ favorited: true, created: true });
    expect(await h.favorites.exists('m-1', 'p-1')).toBe(true);
  });

  it('re-favoriting is the idempotent 200 path — one row, no error (A9)', async () => {
    const h = harness();
    await seedProduct(h.products, 'p-1');
    const member = await seedMember(h.members, 'm-1');

    await h.favoriteProduct.execute('p-1', member);
    const again = await h.favoriteProduct.execute('p-1', member);

    expect(again).toEqual({ favorited: true, created: false });
    const page = await h.favorites.pageFor('m-1', 0, 24);
    expect(page.total).toBe(1);
  });

  it('answers 404 NOT_FOUND for a missing product (상품 없음)', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');

    await expect(h.favoriteProduct.execute('p-unknown', member)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('answers 404 NOT_FOUND for a soft-deleted product (삭제됨)', async () => {
    const h = harness();
    await seedProduct(h.products, 'p-1', 'seller-1', new Date('2026-11-10T08:00:00.000Z'));
    const member = await seedMember(h.members, 'm-1');

    await expect(h.favoriteProduct.execute('p-1', member)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('refuses a missing/blank/non-string product_id with a 400 field error', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');

    await expect(h.favoriteProduct.execute(undefined, member)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { product_id: expect.any(String) },
    });
    await expect(h.favoriteProduct.execute('   ', member)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { product_id: expect.any(String) },
    });
    await expect(h.favoriteProduct.execute(42, member)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('treats the product id as an exact string — no trimming into a different id', () => {
    expect(favoriteProductField(' p-1 ')).toBe('p-1');
  });
});

describe('UnfavoriteProduct use case (§2-4 DELETE, 204 멱등)', () => {
  it('removes the favorite and a repeat call stays silent (멱등)', async () => {
    const h = harness();
    await seedProduct(h.products, 'p-1');
    const member = await seedMember(h.members, 'm-1');
    await h.favoriteProduct.execute('p-1', member);

    const removed = await h.favorites.delete(member.id, 'p-1');
    expect(removed).toBe(true);
    // The use case deletes unconditionally; a second call must not error.
    await expect(h.unfavoriteProduct.execute('p-1', member)).resolves.toBeUndefined();
    expect(await h.favorites.exists(member.id, 'p-1')).toBe(false);
  });

  it('an unknown product id is the same nothing-to-remove state (204, not 404)', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');

    await expect(h.unfavoriteProduct.execute('p-unknown', member)).resolves.toBeUndefined();
  });
});

describe('ListFavorites use case (§2-4 GET, 최신 찜순 ProductCard)', () => {
  it('returns the §2-4 page envelope with 0건 as a 200-shaped empty page', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');

    const page = await h.listFavorites.execute({}, member);

    expect(page).toEqual({ items: [], total: 0, page: 1, limit: 24 });
  });

  it('projects favorited products as ProductCards, newest favorite first (AC6.2)', async () => {
    const h = harness();
    await seedProduct(h.products, 'p-old');
    await seedProduct(h.products, 'p-new');
    const member = await seedMember(h.members, 'm-1');

    const earlier = () => new Date('2026-11-10T09:00:00.000Z');
    const later = () => new Date('2026-11-10T09:05:00.000Z');
    await h.favorites.save(Favorite.create(member.id, 'p-old', earlier));
    await h.favorites.save(Favorite.create(member.id, 'p-new', later));

    const page = await h.listFavorites.execute({}, member);

    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id)).toEqual(['p-new', 'p-old']);
    expect(page.items[0]).toMatchObject({
      id: 'p-new',
      title: SELL_FORM.title,
      price: SELL_FORM.price,
      region: SELL_FORM.region,
      status: 'ACTIVE',
      condition: 'like_new',
      thumbnail_url: SELL_FORM.image_urls[0],
    });
    expect(Object.keys(page.items[0]).sort()).toEqual([
      'condition',
      'created_at',
      'id',
      'price',
      'region',
      'status',
      'thumbnail_url',
      'title',
    ]);
  });

  it('honors page/limit and reports the favorites total (페이징)', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');
    for (let i = 1; i <= 5; i += 1) {
      await seedProduct(h.products, `p-${i}`);
      await h.favorites.save(
        Favorite.create(member.id, `p-${i}`, () => new Date(Date.parse('2026-11-10T09:00:00.000Z') + i * 1000)),
      );
    }

    const page2 = await h.listFavorites.execute({ page: '2', limit: '2' }, member);

    expect(page2.page).toBe(2);
    expect(page2.limit).toBe(2);
    expect(page2.total).toBe(5);
    expect(page2.items.map((item) => item.id)).toEqual(['p-3', 'p-2']);
  });

  it('skips a favorite whose product is deleted or missing — a stale row never renders a deleted listing', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');
    await seedProduct(h.products, 'p-alive');
    await seedProduct(h.products, 'p-dead', 'seller-1', new Date('2026-11-10T08:00:00.000Z'));
    await h.favorites.save(Favorite.create(member.id, 'p-alive', TICK));
    await h.favorites.save(Favorite.create(member.id, 'p-dead', TICK));
    await h.favorites.save(Favorite.create(member.id, 'p-ghost', TICK));

    const page = await h.listFavorites.execute({}, member);

    expect(page.items.map((item) => item.id)).toEqual(['p-alive']);
    // total stays the favorites count — the paging envelope describes the
    // member's favorite list, the AC6.2 cleanup owns making it accurate.
    expect(page.total).toBe(3);
  });

  it('rejects an out-of-range or non-numeric page/limit with a 400 field error', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');

    await expect(h.listFavorites.execute({ limit: '51' }, member)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { limit: expect.any(String) },
    });
    await expect(h.listFavorites.execute({ page: '0' }, member)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { page: expect.any(String) },
    });
    await expect(h.listFavorites.execute({ page: 'abc' }, member)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('treats an empty query value as absent (?page= stays a legal request)', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');
    const query = FavoriteListQuery.parse({ page: '', limit: '' });
    expect(query.page).toBe(1);
    expect(query.limit).toBe(24);
    await expect(h.listFavorites.execute({ page: '', limit: '' }, member)).resolves.toMatchObject({
      page: 1,
      limit: 24,
    });
  });
});

describe('AC6.2 — 상품 삭제 시 Favorite 정리 (repository-level contract duty)', () => {
  it('removeAllForProduct clears every member\'s favorite of the deleted product, and only that product\'s', async () => {
    const h = harness();
    await seedProduct(h.products, 'p-deleted');
    await seedProduct(h.products, 'p-kept');
    const memberA = await seedMember(h.members, 'm-1');
    const memberB = await seedMember(h.members, 'm-2');
    await h.favoriteProduct.execute('p-deleted', memberA);
    await h.favoriteProduct.execute('p-deleted', memberB);
    await h.favoriteProduct.execute('p-kept', memberA);

    const removed = await h.favorites.removeAllForProduct('p-deleted');

    expect(removed).toBe(2);
    expect(await h.favorites.exists(memberA.id, 'p-deleted')).toBe(false);
    expect(await h.favorites.exists(memberB.id, 'p-deleted')).toBe(false);
    // Unrelated favorites survive the cleanup.
    expect(await h.favorites.exists(memberA.id, 'p-kept')).toBe(true);
    // The member's 찜 목록 no longer contains the deleted product (사전 정리).
    const page = await h.listFavorites.execute({}, memberA);
    expect(page.items.map((item) => item.id)).toEqual(['p-kept']);
  });

  it('purging an idempotently repeated call removes nothing more', async () => {
    const h = harness();
    await seedProduct(h.products, 'p-1');
    const member = await seedMember(h.members, 'm-1');
    await h.favoriteProduct.execute('p-1', member);

    expect(await h.favorites.removeAllForProduct('p-1')).toBe(1);
    expect(await h.favorites.removeAllForProduct('p-1')).toBe(0);
  });
});

describe('FavoriteRepositoryLookup — the real FavoriteLookup adapter (C5 seam removed)', () => {
  it('answers the member-product pair from the favorites store', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');
    await seedProduct(h.products, 'p-1');
    await h.favoriteProduct.execute('p-1', member);
    const lookup = new FavoriteRepositoryLookup(h.favorites);

    expect(await lookup.isFavorite('p-1', member.id)).toBe(true);
    expect(await lookup.isFavorite('p-1', 'm-other')).toBe(false);
    expect(await lookup.isFavorite('p-other', member.id)).toBe(false);
  });
});

describe('CurrentMemberGuard — the 찜 endpoints refuse a 비로그인 caller with 401', () => {
  function fakeContext(request: { headers: Record<string, string | undefined> }): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('a request without an Authorization header throws the contract 401', async () => {
    const members = new InMemoryMemberRepository();
    const auth = new AuthenticateMember(members, new SessionTokenService());
    const guard = new CurrentMemberGuard(auth);

    await expect(
      guard.canActivate(fakeContext({ headers: {} })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', httpStatus: 401 });
  });

  it('a live bearer token attaches the member (the 찜 caller is the principal)', async () => {
    const members = new InMemoryMemberRepository();
    const tokens = new SessionTokenService();
    const auth = new AuthenticateMember(members, tokens);
    const guard = new CurrentMemberGuard(auth);
    const member = await seedMember(members, 'm-1');
    const token = await tokens.issue(member.id);

    const request: { headers: Record<string, string | undefined>; currentMember?: Member } = {
      headers: { authorization: `Bearer ${token}` },
    };
    await expect(guard.canActivate(fakeContext(request))).resolves.toBe(true);
    expect(request.currentMember?.id).toBe('m-1');
  });

  it('an unknown token fails uniformly with the contract 401 (§2-0 만료 토큰)', async () => {
    const members = new InMemoryMemberRepository();
    const auth = new AuthenticateMember(members, new SessionTokenService());
    const guard = new CurrentMemberGuard(auth);

    await expect(
      guard.canActivate(fakeContext({ headers: { authorization: 'Bearer no-such-token' } })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', httpStatus: 401 });
  });

  it('keeps DomainError the contract error type for the 404 path', async () => {
    const h = harness();
    const member = await seedMember(h.members, 'm-1');
    const error = await h.favoriteProduct.execute('p-unknown', member).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DomainError);
  });
});
