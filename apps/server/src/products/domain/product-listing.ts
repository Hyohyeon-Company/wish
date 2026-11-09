/**
 * Value object + read model of the product listing query
 * (§2-3 GET /api/products). The listing is a read concern of the Product
 * context: parsing lives beside the aggregate's other value objects so the
 * contract's 400-with-fields body is produced by the domain, not the
 * controller — the same mechanism as the sell form.
 *
 * Recorded contract decisions (user-flow §2-0/§2-3, this card):
 * - `page` starts at 1, `limit` defaults to 24 with a maximum of 50; an
 *   out-of-range or non-numeric page/limit is a 400 field error, not a
 *   silent clamp (visible contract behavior over hidden correction).
 * - an *empty* query value (`?sort=`) is treated as absent — an empty
 *   submission must not become an error (A3: 빈 검색어는 오류 아님).
 * - `sort` accepts exactly the §2-0 enum latest|price_asc|price_desc;
 *   unknown category/status/sort values are the §2-3 400 boundary (A4/A5:
 *   정상 UI 경로에서 발생하지 않는 값만 서버가 거부).
 * - filters combine (AC2.2): q (title 부분 일치, case-insensitive — the
 *   recorded search decision, brief §6 "MySQL LIKE 수준으로 충분"),
 *   category, min_price/max_price (원, 0 허용 하한), status, region
 *   (일치).
 */
import { findCategory } from '../../catalog/domain/category';
import { PRODUCT_STATUSES, type ProductStatus } from './product';
import { fieldFailure, requireValidFields } from './product-field-validation';

export const PRODUCT_SORT_OPTIONS = ['latest', 'price_asc', 'price_desc'] as const;
export type ProductSortOption = (typeof PRODUCT_SORT_OPTIONS)[number];

export const DEFAULT_LIST_LIMIT = 24;
export const MAX_LIST_LIMIT = 50;

export class ProductListingQuery {
  private constructor(
    readonly keyword: string | null,
    readonly categoryCode: string | null,
    readonly minPrice: number | null,
    readonly maxPrice: number | null,
    readonly status: ProductStatus | null,
    readonly region: string | null,
    readonly sort: ProductSortOption,
    readonly page: number,
    readonly limit: number,
  ) {}

  static parse(raw: Record<string, unknown>): ProductListingQuery {
    const fields = requireValidFields((collect) => ({
      keyword: collect(() => parseKeyword(raw.q)) as string | null,
      categoryCode: collect(() => parseCategoryFilter(raw.category)) as string | null,
      minPrice: collect(() => parsePriceBound(raw.min_price, 'min_price')) as number | null,
      maxPrice: collect(() => parsePriceBound(raw.max_price, 'max_price')) as number | null,
      status: collect(() => parseStatusFilter(raw.status)) as ProductStatus | null,
      region: collect(() => parseRegionFilter(raw.region)) as string | null,
      sort: collect(() => parseSort(raw.sort)) as ProductSortOption,
      page: collect(() => parsePage(raw.page)) as number,
      limit: collect(() => parseLimit(raw.limit)) as number,
    }));

    if (
      fields.minPrice !== null &&
      fields.maxPrice !== null &&
      fields.minPrice > fields.maxPrice
    ) {
      fieldFailure('min_price', '최소 가격이 최대 가격보다 클 수 없어요.');
    }

    return new ProductListingQuery(
      fields.keyword,
      fields.categoryCode,
      fields.minPrice,
      fields.maxPrice,
      fields.status,
      fields.region,
      fields.sort,
      fields.page,
      fields.limit,
    );
  }

  /** First row of the page (0-based), derived from the parsed page/limit. */
  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}

function parseKeyword(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string') fieldFailure('q', '검색어를 확인해 주세요.');
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > 100) {
    fieldFailure('q', '검색어는 100자 이하로 입력해 주세요.');
  }
  return value;
}

function parseCategoryFilter(raw: unknown): string | null {
  if (raw === undefined || raw === '') return null;
  const category = findCategory(raw);
  if (category === null) {
    fieldFailure('category', '카테고리를 확인해 주세요.');
  }
  return category.code;
}

function parsePriceBound(raw: unknown, field: 'min_price' | 'max_price'): number | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    fieldFailure(field, '가격 범위를 확인해 주세요.');
  }
  const value = Number(raw);
  if (value > Number.MAX_SAFE_INTEGER) {
    fieldFailure(field, '가격 범위를 확인해 주세요.');
  }
  return value;
}

function parseStatusFilter(raw: unknown): ProductStatus | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !PRODUCT_STATUSES.includes(raw as ProductStatus)) {
    fieldFailure('status', '상태 값을 확인해 주세요.');
  }
  return raw as ProductStatus;
}

function parseRegionFilter(raw: unknown): string | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') {
    fieldFailure('region', '지역 값을 확인해 주세요.');
  }
  const value = raw.trim();
  if (value.length > 20) {
    fieldFailure('region', '지역 값은 20자 이하로 요청해 주세요.');
  }
  return value.length === 0 ? null : value;
}

function parseSort(raw: unknown): ProductSortOption {
  if (raw === undefined || raw === '') return 'latest';
  if (
    typeof raw !== 'string' ||
    !PRODUCT_SORT_OPTIONS.includes(raw as ProductSortOption)
  ) {
    fieldFailure('sort', '정렬 값을 확인해 주세요.');
  }
  return raw as ProductSortOption;
}

function parsePage(raw: unknown): number {
  if (raw === undefined || raw === '') return 1;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1) {
    fieldFailure('page', '페이지는 1 이상의 숫자로 요청해 주세요.');
  }
  return Number(raw);
}

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === '') return DEFAULT_LIST_LIMIT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    fieldFailure('limit', 'limit은 1 이상 50 이하로 요청해 주세요.');
  }
  const value = Number(raw);
  if (value < 1 || value > MAX_LIST_LIMIT) {
    fieldFailure('limit', 'limit은 1 이상 50 이하로 요청해 주세요.');
  }
  return value;
}
