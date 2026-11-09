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
import { fieldFailure } from './product-field-validation';
import { DomainError } from '../../shared/domain-error';
import type { ProductListingQuery } from './product-listing';
import type { MyProductsQuery } from './my-products-query';

export const PRODUCT_STATUSES = ['ACTIVE', 'RESERVED', 'SOLD'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * The §6 상태 전이표 (brief §6, card C7): the ONLY legal status changes.
 * SOLD (거래완료) is terminal — no outgoing transition exists, so a
 * 거래완료→판매중 request (직접 API 호출 포함, B11) is refused with the
 * contract's 400 INVALID_TRANSITION. The table is the aggregate's own
 * rule: nothing outside Product may widen it.
 */
export const PRODUCT_TRANSITIONS: Readonly<
  Record<ProductStatus, readonly ProductStatus[]>
> = {
  ACTIVE: ['RESERVED', 'SOLD'],
  RESERVED: ['ACTIVE', 'SOLD'],
  SOLD: [],
};

/** Validates a PATCH {status} body field: known enum value or a 400 field error. */
export function parseStatusField(raw: unknown): ProductStatus {
  if (typeof raw !== 'string' || !PRODUCT_STATUSES.includes(raw as ProductStatus)) {
    fieldFailure('status', '상태 값을 확인해 주세요.');
  }
  return raw as ProductStatus;
}

/** The contract's 전이표 밖 전이 error (§2-3 PATCH row: 400 INVALID_TRANSITION). */
export function invalidTransitionError(from: ProductStatus, to: ProductStatus): DomainError {
  const labels: Record<ProductStatus, string> = {
    ACTIVE: '판매중',
    RESERVED: '예약중',
    SOLD: '거래완료',
  };
  const message =
    to === 'SOLD' && from === 'SOLD'
      ? '거래완료된 상품의 상태는 변경할 수 없어요.'
      : `'${labels[from]}'에서 '${labels[to]}'(으)로 상태를 변경할 수 없어요.`;
  return new DomainError('INVALID_TRANSITION', message);
}

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
  /**
   * Optimistic-concurrency token (§2-5-5 recorded decision): every write
   * goes through the repository's conditional save, so a stale writer —
   * two racing status changes, or a status change racing a deletion —
   * observes the contract's 409 instead of silently overwriting. The
   * adapter owns the counter's storage; the aggregate only carries it.
   */
  readonly version: number;
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
 * query value object owns which values are legal. `trySave` is the
 * §2-5-5 concurrency control: a conditional write that succeeds only when
 * the stored row still carries `expectedVersion`, answering false on a
 * lost race (the caller renders the contract's 409).
 */
export abstract class ProductRepository {
  abstract save(product: Product): Promise<void>;
  abstract findById(id: string): Promise<Product | null>;
  abstract list(query: ProductListingQuery): Promise<ProductPage>;
  /** Conditional save for C7 writes; false = lost race (409). */
  abstract trySave(next: Product, expectedVersion: number): Promise<boolean>;
  /** One page of a seller's own listings (§2-4 GET /api/me/products). */
  abstract listBySeller(sellerId: string, query: MyProductsQuery): Promise<ProductPage>;
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
    private readonly version: number,
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
      0,
    );
  }

  isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  /** The concurrency token the persistence boundary handed back. */
  snapshotVersion(): number {
    return this.version;
  }

  /**
   * C7 (B10): the aggregate's own status-change operation. It refuses every
   * transition outside the §6 전이표 (INVALID_TRANSITION) — including any
   * change out of the terminal SOLD state — and returns a NEW product
   * carrying the change (the aggregate stays immutable; persistence writes
   * the returned instance). `now` stamps updatedAt.
   */
  changeStatus(next: ProductStatus, now: Date): Product {
    if (next === this.status || !PRODUCT_TRANSITIONS[this.status].includes(next)) {
      throw invalidTransitionError(this.status, next);
    }
    return this.with({ status: next, updatedAt: now });
  }

  /**
   * C7 (B12): soft deletion — §6 deleted_at. Like changeStatus it returns a
   * new instance; the deletion use case writes it together with the AC6.2
   * favorite cleanup inside one transaction.
   */
  markDeleted(now: Date): Product {
    if (this.deletedAt !== null) {
      // Unreachable through the API (the use case 404s deleted products
      // first); guarded here so the aggregate cannot double-delete.
      throw new DomainError('NOT_FOUND', '이미 삭제된 상품이에요.');
    }
    return this.with({ deletedAt: now, updatedAt: now });
  }

  /** Infrastructure-only replacement constructor for adapter bookkeeping. */
  private with(
    changes: {
      status?: ProductStatus;
      updatedAt?: Date;
      deletedAt?: Date | null;
      version?: number;
    },
  ): Product {
    const snapshot = this.toSnapshot();
    return new Product(
      snapshot.id,
      snapshot.sellerId,
      this.title,
      this.price,
      this.categoryCode,
      this.condition,
      this.description,
      this.region,
      changes.status ?? snapshot.status,
      snapshot.images,
      snapshot.createdAt,
      changes.updatedAt ?? snapshot.updatedAt,
      changes.deletedAt !== undefined ? changes.deletedAt : snapshot.deletedAt,
      changes.version ?? snapshot.version,
    );
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
      version: this.version,
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
      snapshot.version,
    );
  }
}
