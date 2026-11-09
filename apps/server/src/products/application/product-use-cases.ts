/**
 * Application use cases of the sell/catalog slice (user-flow §2-2·§2-3):
 * listing a category set, storing one uploaded photo, and creating a product
 * listing. They coordinate the domain objects and ports; every business rule
 * lives in the domain — the application layer only arranges the steps.
 */
import { randomUUID } from 'node:crypto';
import type { Member, MemberRepository } from '../../members/domain/member';
import { DomainError } from '../../shared/domain-error';
import { listCategories } from '../../catalog/domain/category';
import { Product, type ProductRepository, type ProductSnapshot } from '../domain/product';
import {
  ProductListingQuery,
} from '../domain/product-listing';
import {
  parseImageMetadata,
  extensionFor,
  refuseNonImage,
} from '../infrastructure/image-metadata';

// ---------------------------------------------------------------------------
// Categories (§2-2 GET /api/categories)
// ---------------------------------------------------------------------------

export interface CategoryView {
  readonly code: string;
  readonly name: string;
  readonly display_order: number;
}

export class ListCategories {
  execute(): CategoryView[] {
    return listCategories().map((category) => ({
      code: category.code,
      name: category.name,
      display_order: category.displayOrder,
    }));
  }
}

// ---------------------------------------------------------------------------
// Uploads (§2-2 POST /api/uploads)
// ---------------------------------------------------------------------------

/** The multipart part produced by the platform's FileInterceptor. */
export interface UploadedImageFile {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface UploadedImageView {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
}

/** Storage boundary of uploaded images (adapter per environment). */
export abstract class ImageStore {
  abstract save(data: Buffer, extension: string): Promise<string>;
}

/**
 * Recorded decision: the per-upload ceiling is 10 MiB. Typical phone photos
 * of listing objects stay far below it, the framework-level limit keeps a
 * request's memory bounded (multer's default memory storage), and the
 * contract fixes only the "용량 초과 400" boundary, not the number — this
 * value is the backend's to choose with rationale (user-flow §2-5-3).
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The contract's fixed oversize boundary (§2-2): a 400 with `fields.image`. */
export function oversizeImageError(): DomainError {
  return new DomainError(
    'VALIDATION_FAILED',
    '이미지 용량이 너무 커요. 10MB 이하로 올려주세요.',
    { image: '이미지 용량이 너무 커요. 10MB 이하로 올려주세요.' },
  );
}

export class UploadImage {
  constructor(private readonly images: ImageStore) {}

  async execute(file: UploadedImageFile): Promise<UploadedImageView> {
    if (file.size > MAX_UPLOAD_BYTES) {
      // Belt-and-braces alongside the multer limit: the boundary must hold
      // regardless of which layer catches it first.
      throw oversizeImageError();
    }
    const metadata = parseImageMetadata(file.buffer);
    if (metadata === null) {
      refuseNonImage();
    }
    const url = await this.images.save(file.buffer, extensionFor(metadata.format));
    return { url, width: metadata.width, height: metadata.height, size: file.size };
  }
}

// ---------------------------------------------------------------------------
// Product creation (§2-3 POST /api/products)
// ---------------------------------------------------------------------------

export interface ProductSellerView {
  readonly id: string;
  readonly nickname: string;
  readonly region: string;
}

export interface ProductImageView {
  readonly url: string;
  readonly sort_order: number;
}

/** Shared projection of a product (the §2-3 `product` object, detail shape). */
export interface ProductView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly price: number;
  readonly category_code: string;
  readonly condition: string;
  readonly region: string;
  readonly status: string;
  readonly created_at: string;
  readonly seller: ProductSellerView;
  readonly images: readonly ProductImageView[];
}

export class CreateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * `seller` is the authenticated principal handed over by the guard — the
   * use case never reads a seller from `raw` (AC4.4: a body that carries
   * `seller_id` is not read; the listing always belongs to the caller).
   */
  async execute(raw: Record<string, unknown>, seller: Member): Promise<{ product: ProductView }> {
    const product = Product.create(
      {
        title: raw.title,
        price: raw.price,
        category_code: raw.category_code,
        condition: raw.condition,
        description: raw.description,
        region: raw.region,
        image_urls: raw.image_urls,
      },
      { sellerId: seller.id, generateId: () => randomUUID(), now: this.now },
    );
    await this.products.save(product);
    return { product: toProductView(product, seller) };
  }
}

// ---------------------------------------------------------------------------
// Product listing (§2-3 GET /api/products)
// ---------------------------------------------------------------------------

/** The §2-4 ProductCard shape — the feed's minimum unit. */
export interface ProductCardView {
  readonly id: string;
  readonly title: string;
  readonly price: number;
  readonly region: string;
  readonly status: string;
  readonly created_at: string;
  readonly thumbnail_url: string | null;
  readonly condition: string;
}

export interface ProductListPage {
  readonly items: readonly ProductCardView[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export class ListProducts {
  constructor(private readonly products: ProductRepository) {}

  /**
   * The raw query string map is transport input; its legality is decided by
   * the ProductListingQuery value object (400 with fields), the adapter owns
   * execution, and this use case only arranges the projection.
   */
  async execute(rawQuery: Record<string, unknown>): Promise<ProductListPage> {
    const query = ProductListingQuery.parse(rawQuery);
    const page = await this.products.list(query);
    return {
      items: page.items.map((product) => toProductCardView(product)),
      total: page.total,
      page: query.page,
      limit: query.limit,
    };
  }
}

// ---------------------------------------------------------------------------
// Product detail (§2-3 GET /api/products/{id})
// ---------------------------------------------------------------------------

/**
 * Whether a member has favorited a product (port; adapter per environment).
 * The favorited field is part of the §2-3 detail contract from day one, but
 * the favorites aggregate itself is card C6's slice — until C6 lands its
 * writes, no favorite can exist, so the adapter legitimately answers false
 * for every viewer.
 */
export abstract class FavoriteLookup {
  abstract isFavorite(productId: string, memberId: string): Promise<boolean>;
}

/** The §2-3 GET /api/products/{id} success body. */
export interface ProductDetailView {
  readonly product: ProductView;
  /** 로그인 viewer → bool, 비로그인 → null (§2-3 favorited contract). */
  readonly favorited: boolean | null;
}

export class ReadProductDetail {
  constructor(
    private readonly products: ProductRepository,
    private readonly members: MemberRepository,
    private readonly favorites: FavoriteLookup,
  ) {}

  /**
   * Public read: `viewer` is the authenticated principal when a live token
   * was presented and null otherwise (the optional guard decides, §3 marks
   * detail-v1 a 공개 화면). A missing or soft-deleted product is the
   * contract's 404 NOT_FOUND (존재하지 않음·삭제됨) — deletion is not an
   * idempotent "gone", it is an error state to observe (AC3.2).
   */
  async execute(id: unknown, viewer: Member | null): Promise<ProductDetailView> {
    const product =
      typeof id === 'string' && id.length > 0 ? await this.products.findById(id) : null;
    if (product === null || product.isDeleted()) {
      throw new DomainError(
        'NOT_FOUND',
        '상품을 찾을 수 없어요. 삭제되었거나 만료된 상품일 수 있어요.',
      );
    }
    const seller = await this.members.findById(product.sellerId);
    if (seller === null) {
      // A product whose seller no longer resolves is corrupted state — the
      // same public 404 absorbs it instead of surfacing a 500 shape.
      throw new DomainError('NOT_FOUND', '상품을 찾을 수 없어요.');
    }
    const favorited =
      viewer === null ? null : await this.favorites.isFavorite(product.id, viewer.id);
    return { product: toProductView(product, seller), favorited };
  }
}

/** thumbnail은 sort_order 최소 이미지; 없으면 null (클라가 플레이스홀더 렌더). */
export function toProductCardView(product: Product): ProductCardView {
  const snapshot: ProductSnapshot = product.toSnapshot();
  const thumbnail =
    [...snapshot.images].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
  return {
    id: snapshot.id,
    title: snapshot.title,
    price: snapshot.price,
    region: snapshot.region,
    status: snapshot.status,
    created_at: snapshot.createdAt.toISOString(),
    thumbnail_url: thumbnail === null ? null : thumbnail.url,
    condition: snapshot.condition,
  };
}

export function toProductView(product: Product, seller: Member): ProductView {
  const snapshot: ProductSnapshot = product.toSnapshot();
  return {
    id: snapshot.id,
    title: snapshot.title,
    description: snapshot.description,
    price: snapshot.price,
    category_code: snapshot.categoryCode,
    condition: snapshot.condition,
    region: snapshot.region,
    status: snapshot.status,
    created_at: snapshot.createdAt.toISOString(),
    seller: { id: seller.id, nickname: seller.nickname.value, region: seller.region.value },
    // sort_order ascending regardless of stored order — the contract's
    // images array is the gallery's display order (first = 대표).
    images: [...snapshot.images]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => ({ url: image.url, sort_order: image.sortOrder })),
  };
}
