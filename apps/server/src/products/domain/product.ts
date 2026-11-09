/**
 * Product aggregate root (brief §6 Product): identity, seller, listing
 * fields, sales status, soft deletion and the 1..10 image list.
 *
 * Invariants owned here:
 * - every listing field passes its value-object validation at creation;
 * - a new product starts ACTIVE (판매중) — the §6 status enum's initial state;
 * - images keep their submitted order as sort_order (first = 대표);
 * - seller_id is part of the aggregate's identity, assigned by the use case
 *   from the *authenticated principal* — never from request input (AC4.4:
 *   변조 불가 구조; a body that carries seller_id is simply not read).
 *
 * Status transitions (판매중⇄예약중→거래완료, sold as terminal state) are
 * journey B10 / card C7 — this slice only fixes the enum and the initial
 * state so C7 adds behavior without reshaping the aggregate.
 */
import {
  ProductCondition,
  ProductImageList,
  ProductTitle,
  ProductPrice,
  ProductDescription,
  ProductRegion,
  type ProductCreationFields,
  requireProductFields,
  parseCategoryCode,
} from './product-value-objects';
import type { ProductListingQuery } from './product-listing';

export const PRODUCT_STATUSES = ['ACTIVE', 'RESERVED', 'SOLD'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface ProductImageSnapshot {
  readonly url: string;
  readonly sortOrder: number;
}

export interface ProductSnapshot {
  readonly id: string;
  readonly sellerId: string;
  readonly title: string;
  readonly description: string;
  readonly price: number;
  readonly categoryCode: string;
  readonly condition: string;
  readonly region: string;
  readonly status: ProductStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly images: readonly ProductImageSnapshot[];
}

/** Raw, unvalidated sell-form input (transport shape, §2-3 request body). */
export interface SellProductInput {
  readonly title: unknown;
  readonly price: unknown;
  readonly category_code: unknown;
  readonly condition: unknown;
  readonly description: unknown;
  readonly region: unknown;
  readonly image_urls: unknown;
}

/** One page of the §2-3 GET listing: the matching rows plus the full total. */
export interface ProductPage {
  readonly items: readonly Product[];
  readonly total: number;
}

/**
 * Persistence boundary of the Product aggregate (adapter per environment).
 * `list` serves the §2-3 GET listing; the adapter owns the execution shape
 * (WHERE/ORDER/OFFSET for a SQL adapter, in-memory filtering here) — the
 * query value object owns which values are legal.
 */
export abstract class ProductRepository {
  abstract save(product: Product): Promise<void>;
  abstract findById(id: string): Promise<Product | null>;
  abstract list(query: ProductListingQuery): Promise<ProductPage>;
}

export class Product {
  private constructor(
    readonly id: string,
    readonly sellerId: string,
    private readonly title: ProductTitle,
    private readonly price: ProductPrice,
    private readonly categoryCode: string,
    private readonly condition: ProductCondition,
    private readonly description: ProductDescription,
    private readonly region: ProductRegion,
    private readonly status: ProductStatus,
    private readonly images: readonly ProductImageSnapshot[],
    private readonly createdAt: Date,
    private readonly updatedAt: Date,
    private readonly deletedAt: Date | null,
  ) {}

  /**
   * The only way a Product comes into existence. `category` must already be
   * resolved to an existing code by the caller — an unknown code is a field
   * failure raised here so the 400 body carries `category_code`.
   */
  static create(
    raw: SellProductInput,
    deps: {
      sellerId: string;
      generateId: () => string;
      now: () => Date;
    },
  ): Product {
    const fields: ProductCreationFields = requireProductFields((collect) => ({
      title: collect(() => ProductTitle.parse(raw.title)) as ProductTitle,
      price: collect(() => ProductPrice.parse(raw.price)) as ProductPrice,
      categoryCode: collect(() => parseCategoryCode(raw.category_code)) as string,
      condition: collect(() => ProductCondition.parse(raw.condition)) as ProductCondition,
      description: collect(() => ProductDescription.parse(raw.description)) as ProductDescription,
      region: collect(() => ProductRegion.parse(raw.region)) as ProductRegion,
      imageUrls: collect(() => {
        const list = ProductImageList.parse(raw.image_urls);
        ProductImageList.assertNoDuplicates(list.urls);
        return list.urls;
      }) as readonly string[],
    }));

    const now = deps.now();
    const images: ProductImageSnapshot[] = fields.imageUrls.map((url, index) => ({
      url,
      sortOrder: index + 1,
    }));
    return new Product(
      deps.generateId(),
      deps.sellerId,
      fields.title,
      fields.price,
      fields.categoryCode,
      fields.condition,
      fields.description,
      fields.region,
      'ACTIVE',
      images,
      now,
      now,
      null,
    );
  }

  isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  toSnapshot(): ProductSnapshot {
    return {
      id: this.id,
      sellerId: this.sellerId,
      title: this.title.value,
      description: this.description.value,
      price: this.price.value,
      categoryCode: this.categoryCode,
      condition: this.condition.value,
      region: this.region.value,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      deletedAt: this.deletedAt,
      images: [...this.images],
    };
  }

  /** Rehydrate a persisted product. Infrastructure-only. */
  static fromSnapshot(snapshot: ProductSnapshot): Product {
    return new Product(
      snapshot.id,
      snapshot.sellerId,
      ProductTitle.parse(snapshot.title),
      ProductPrice.parse(snapshot.price),
      snapshot.categoryCode,
      ProductCondition.parse(snapshot.condition),
      ProductDescription.parse(snapshot.description),
      ProductRegion.parse(snapshot.region),
      snapshot.status,
      snapshot.images,
      snapshot.createdAt,
      snapshot.updatedAt,
      snapshot.deletedAt,
    );
  }
}
