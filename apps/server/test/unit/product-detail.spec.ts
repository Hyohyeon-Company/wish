/**
 * Product detail rules in isolation (no HTTP, no Nest) — the C5 card's core
 * checks (§2-3 GET /api/products/{id}): the 404 NOT_FOUND boundary for a
 * missing AND a soft-deleted product (AC3.2), the images array's
 * sort_order-ascending display order regardless of stored row order, and
 * the favorited contract — 로그인 viewer → bool, 비로그인 → null — now
 * answered by the real favorites adapter (card C6 replaced the C5 seam).
 */
import 'reflect-metadata';
import { Member, MemberRepository, type PasswordHasher } from '../../src/members/domain/member';
import { Product, type ProductSnapshot } from '../../src/products/domain/product';
import {
  ReadProductDetail,
} from '../../src/products/application/product-use-cases';
import { Favorite } from '../../src/favorites/domain/favorite';
import { InMemoryFavoriteRepository } from '../../src/favorites/infrastructure/in-memory-favorite.repository';
import { FavoriteRepositoryLookup } from '../../src/favorites/infrastructure/favorite-repository.lookup';
import { InMemoryProductRepository } from '../../src/products/infrastructure/in-memory-product.repository';
import { DomainError } from '../../src/shared/domain-error';

/**
 * The real favorites store behind the FavoriteLookup port — since card C6
 * the adapter is the actual favorites aggregate, not the C5-time false stub.
 */
function realFavorites(): FavoriteRepositoryLookup {
  return new FavoriteRepositoryLookup(new InMemoryFavoriteRepository());
}

const stubHasher = {
  hash: async (plain: string) => `hash(${plain})`,
  verify: async () => true,
} as unknown as PasswordHasher;

/** One persisted member — the detail's seller, and a second one as viewer. */
async function seedMember(id: string, nickname: string): Promise<Member> {
  return Member.signUp(
    {
      email: `${id}@example.com`,
      password: 'Str0ng-Pass!',
      nickname,
      region: '사당동',
    },
    { hasher: stubHasher, generateId: () => id, now: () => new Date('2026-11-01T09:00:00.000Z') },
  );
}

class FakeMemberRepository extends MemberRepository {
  constructor(private readonly member: Member | null) {
    super();
  }
  async findByEmail(): Promise<Member | null> {
    return this.member;
  }
  async findById(): Promise<Member | null> {
    return this.member;
  }
  async save(): Promise<void> {}
}

const SELL_FORM = {
  title: '원목 식탁 4인용',
  price: 120000,
  category_code: 'furniture',
  condition: 'like_new',
  description: '이사 가면서 판매합니다.\n표면 스크래치 거의 없어요.',
  region: '사당동',
  image_urls: [
    'http://localhost:3000/uploads/table-1.png',
    'http://localhost:3000/uploads/table-2.png',
    'http://localhost:3000/uploads/table-3.png',
  ],
};

async function seedProduct(
  products: InMemoryProductRepository,
  overrides: { images?: readonly string[] } = {},
): Promise<Product> {
  const product = Product.create(
    {
      ...SELL_FORM,
      image_urls: overrides.images ?? SELL_FORM.image_urls,
    } as unknown as Parameters<typeof Product.create>[0],
    {
      sellerId: 'seller-1',
      generateId: () => 'product-1',
      now: () => new Date('2026-11-09T09:00:00.000Z'),
    },
  );
  await products.save(product);
  return product;
}

describe('ReadProductDetail (§2-3 GET /api/products/{id})', () => {
  let products: InMemoryProductRepository;

  beforeEach(() => {
    products = new InMemoryProductRepository();
  });

  it('serves the full §2-3 product contract for a guest (favorited null)', async () => {
    await seedProduct(products);
    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(await seedMember('seller-1', '판매자')),
      realFavorites(),
    );

    const response = await detail.execute('product-1', null);

    expect(response.favorited).toBeNull();
    expect(Object.keys(response.product).sort()).toEqual([
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
    expect(response.product.id).toBe('product-1');
    expect(response.product.title).toBe('원목 식탁 4인용');
    expect(response.product.price).toBe(120000);
    expect(response.product.category_code).toBe('furniture');
    expect(response.product.condition).toBe('like_new');
    expect(response.product.region).toBe('사당동');
    expect(response.product.status).toBe('ACTIVE');
    expect(response.product.created_at).toBe('2026-11-09T09:00:00.000Z');
  });

  it('projects the seller (id·nickname·region) from the member aggregate', async () => {
    await seedProduct(products);
    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(await seedMember('seller-1', '샘플판매자')),
      realFavorites(),
    );

    const { product } = await detail.execute('product-1', null);

    expect(product.seller).toEqual({ id: 'seller-1', nickname: '샘플판매자', region: '사당동' });
  });

  it('answers a logged-in viewer with a boolean favorited (계약: 로그인 bool)', async () => {
    await seedProduct(products);
    const viewer = await seedMember('viewer-1', '구경꾼');
    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(await seedMember('seller-1', '판매자')),
      realFavorites(),
    );

    // The real favorites store starts empty (no favorite saved yet), so the
    // honest boolean is false — never null for a logged-in viewer.
    const response = await detail.execute('product-1', viewer);
    expect(response.favorited).toBe(false);
  });

  it('answers favorited true once the member actually favorited (C6 adapter)', async () => {
    await seedProduct(products);
    const viewer = await seedMember('viewer-1', '구경꾼');
    const favorites = new InMemoryFavoriteRepository();
    await favorites.save(
      Favorite.create(viewer.id, 'product-1', () => new Date('2026-11-09T11:00:00.000Z')),
    );
    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(await seedMember('seller-1', '판매자')),
      new FavoriteRepositoryLookup(favorites),
    );

    const response = await detail.execute('product-1', viewer);
    expect(response.favorited).toBe(true);
  });

  it('answers a missing product with the contract 404 NOT_FOUND', async () => {
    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(null),
      realFavorites(),
    );

    await expect(detail.execute('product-unknown', null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('answers a soft-deleted product with the same 404 NOT_FOUND (AC3.2)', async () => {
    const product = await seedProduct(products);
    // C7 owns DELETE /api/products/{id}; the snapshot round-trip stands in
    // for the deletion it will perform (deleted_at set, listing excluded).
    const deleted = Product.fromSnapshot({
      ...product.toSnapshot(),
      deletedAt: new Date('2026-11-09T10:00:00.000Z'),
    } satisfies ProductSnapshot);
    await products.save(deleted);

    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(null),
      realFavorites(),
    );

    await expect(detail.execute('product-1', null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('renders images in sort_order ascending order regardless of stored order', async () => {
    // A SQL adapter owns its row order; the projection must not inherit it.
    // Rehydrating with a shuffled array stands in for the adapter's order.
    await seedProduct(products);
    const shuffled = Product.fromSnapshot({
      ...(await products.findById('product-1'))!.toSnapshot(),
      images: [
        { url: 'http://localhost:3000/uploads/table-3.png', sortOrder: 3 },
        { url: 'http://localhost:3000/uploads/table-1.png', sortOrder: 1 },
        { url: 'http://localhost:3000/uploads/table-2.png', sortOrder: 2 },
      ],
    } satisfies ProductSnapshot);
    await products.save(shuffled);

    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(await seedMember('seller-1', '판매자')),
      realFavorites(),
    );

    const { product } = await detail.execute('product-1', null);
    expect(product.images.map((image) => image.sort_order)).toEqual([1, 2, 3]);
    expect(product.images.map((image) => image.url)).toEqual([
      'http://localhost:3000/uploads/table-1.png',
      'http://localhost:3000/uploads/table-2.png',
      'http://localhost:3000/uploads/table-3.png',
    ]);
  });

  it('treats an empty id like a missing product (404, not a repository scan)', async () => {
    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(null),
      realFavorites(),
    );

    await expect(detail.execute('', null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps DomainError the contract error type (존재하지 않음·삭제됨 message)', async () => {
    const detail = new ReadProductDetail(
      products,
      new FakeMemberRepository(null),
      realFavorites(),
    );

    const error = await detail.execute('product-unknown', null).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('NOT_FOUND');
  });
});
