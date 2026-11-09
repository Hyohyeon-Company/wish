/**
 * Value object of the §2-4 GET /api/me/products query (card C7): the
 * seller's own listings, optionally filtered by status. Page/limit legality
 * is the same §2-0 envelope as the public listing (1-start page, limit
 * default 24 / max 50) — the same values, the same 400-with-fields errors.
 * An empty value is treated as absent, like every other query string.
 */
import { PRODUCT_STATUSES, type ProductStatus } from './product';
import { fieldFailure } from './product-field-validation';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from './product-listing';

export class MyProductsQuery {
  private constructor(
    readonly status: ProductStatus | null,
    readonly page: number,
    readonly limit: number,
  ) {}

  static parse(raw: Record<string, unknown>): MyProductsQuery {
    const status = parseStatus(raw.status);
    const page = parsePage(raw.page);
    const limit = parseLimit(raw.limit);
    return new MyProductsQuery(status, page, limit);
  }

  /** First row of the page (0-based), derived from the parsed page/limit. */
  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}

function parseStatus(raw: unknown): ProductStatus | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !PRODUCT_STATUSES.includes(raw as ProductStatus)) {
    fieldFailure('status', '상태 값을 확인해 주세요.');
  }
  return raw as ProductStatus;
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
